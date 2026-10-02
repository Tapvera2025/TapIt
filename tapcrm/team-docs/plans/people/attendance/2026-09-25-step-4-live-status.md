# Step 4 — Punching and the live board (`live-status`): implementation plan

**Design.** `team-docs/specs/people/2026-09-22-attendance-shifts-payroll-design.md`
§9 (Step 4), the state machine of §5.3 (`presence.ts` already in the repo),
and the `PresenceProjector` port §4 names.
**Roadmap.** `team-docs/plans/people/attendance/2026-09-25-attendance-roadmap.md`.
**Builds on.** Steps 0, 1, 2, 3a, 3b and 3c, as they are in the working tree
on `Archi`.

## What step 4 adds

3a records punches and files them on the right day. 3b keeps each day's
answer current. 3c materialises every day. Step 4 gives the outside world
a live view of who is at work right now, and — once **G1** lands — the one
endpoint an employee uses to punch in, take a break and punch out.

Three promises hold:

- **The board and the calculator agree on when a day ended.** They both
  read the same effective events through the same order (§5.3 `readDay`),
  so `FINISHED` is reached at exactly the departure the calculator books.
- **A person's row is about a person, not a day.** Its `work_date` follows
  the person's own boundary (§5.2 `currentDayFor`) so a night worker at
  02:00 is still on yesterday's date, and at 06:30 with a pulled-forward
  arrival they are already on the next one.
- **Every punch — web, device, correction, auto-close — updates the board
  in the same transaction as `appendEvent`.** The `PresenceProjector` port
  attendance calls at §8.4 step 11 is finally implemented; the socket
  event goes out after commit (LS-8).

How the pieces fit:

```
POST /api/status/punch (G1)              device punch (step 5)
   │ AttendanceFacade.appendEvent(...)      │ AttendanceFacade.appendEvent(...)
   ▼                                        ▼
   attendance ledger writes; inside the same transaction:
   PresenceProjector.apply  or  .refresh (this plan)
       │ writes user_status
       │ queues a `status:changed` post-commit hook
       ▼
   after commit → emitAboutPerson('status', subject, 'status:changed', {…})
   Redis-adapter fans out to every API instance and out to sockets

rollover sweeper (every 5 minutes)
   picks rows whose rollover_due_at <= now, calls refresh — the row moves to
   the person's new day, the group counts stay honest at their own boundary

GET /api/attendance/live                     GET /api/attendance/live?self=true
   scope-filtered board (LS-2, LS-3)         the caller's own row + allowedMoves
   groups: working / possibly-finished /     /today reads this — no separate
   on-break / finished / not-in / on-leave   endpoint (design §9.4)
```

**Done when** — each proved by a named test:

| Check | Test |
|---|---|
| The projection agrees with the calculator on `FINISHED`: a day reaches `FINISHED` exactly at the departure `readDay` produces | `projector.test.ts` › "reaches FINISHED at the departure `readDay` books" |
| `apply` steps `WORKING → ON_BREAK → WORKING → FINISHED` for a normal day | `projector.integration.test.ts` › "day-in-the-life: in, break-start, break-end, out" |
| `apply` falls back to `refresh` when the event changes the person's day (D9 condition 3) | `projector.integration.test.ts` › "a 06:30 punch that resolves to Monday rebuilds Sunday's row into Monday" |
| Rollover sweeper moves a night worker's row at 12:31 without any event happening | `rollover.integration.test.ts` › "a night worker's row rolls at their own boundary" |
| An active person with an `attendance_record` but no `user_status` gets a `NOT_IN` row on the next sweep (bootstrap, LS-1) | `rollover.integration.test.ts` › "bootstrap: an active employee with an `attendance_record` but no `user_status` row is materialised as `NOT_IN`" |
| `likely_finished_at` takes a WORKING·assumed row out of the working count | `projector.integration.test.ts` › "an undirected last-scan at shift-end sets likely_finished_at" |
| `/api/attendance/live` scope-filters the same way as the socket room | `board.integration.test.ts` › "a team lead's board holds exactly their team, and their socket receives exactly that team's `status:changed`" |
| After a Team A → Team B transfer, a `status:changed` emit reaches Team B's viewers, not Team A's | `projector.integration.test.ts` › "transfer invariance: an emit after a Team A → Team B move goes to Team B's viewers, not Team A's" |
| `/today` returns the caller's own row and the correct `allowedMoves` | `today.integration.test.ts` › "own row + `allowedMoves` for the current day; the next day's `in` while the previous night is still open" |
| An event on a person emits ONE `status:changed` to every viewer whose scope covers them, once (RT-4, RT-5). Payload is exactly `{ userId }`. | `board.integration.test.ts` › "one status:changed per event; payload is { userId } only" |

**Done when (design §9)** the board reflects a punch within 3 seconds at
2,000 employees and 1,200 connections. Load-verified out of band; this plan
builds a scale-representative integration test but does not stand up 2,000
users.

**How to use this plan.** Do the tasks in order. Each writes its test
first, watches it fail, adds the code, then watches it pass. Nothing is
committed; each task ends with its changes left for review.

Unlike the 3a/3b plans, the code below has **not** yet been run against the
repository — this is a plan you will execute. Follow the shape; use the
test output to fix specifics that drift.

---

## The G1 wall

**`status:punch` is not in the registry**, so the punch route cannot be
registered until the document owners answer G1 (README question 3). What is
buildable now, and what waits:

| Piece | Status here |
|---|---|
| `user_status` table + projector + rollover sweeper | Built |
| `status:changed` socket channel | Built |
| `GET /api/attendance/live` (board + `/today`) | Built |
| `POST /api/status/punch` route | **Deferred** — the plan authors it as a ready-to-register stub in one file, with its handler already tested by calling `AttendanceFacade.appendEvent` directly. Landing the route is a one-line change once G1 is answered |
| Load test to NF-2 (2000 employees, 1200 connections, 3-second latency) | Out of scope for this plan |
| Go-live | Also needs Q1–Q4 (HR: day thresholds, unpaid-break rule, auto-close delay, grace) and Q6 (arrival policy default) |

Building the read side and the projector first is deliberate: every device
punch from step 5 will drive the same projection, so the projector must be
live before step 5 does anything real.

---

## Decisions made in this plan

| Question | Decision | Why |
|---|---|---|
| One row per person, not per (person, day) | Follow §9.3 verbatim: primary key `(organization_id, user_id)`. `work_date` on the row is the person's current day, rewritten as the day rolls over | Two rows per person means two answers to "what state are they in," which is what LS-1 forbids. The rollover sweeper's job is to keep the row honest at the person's own boundary |
| Where the state machine lives | `packages/contracts/src/presence.ts` (already there). Neither `attendance` nor `live-status` re-declares it | SM-3, LS-1: one state machine, one source of truth. This plan imports `PRESENCE`, `nextState`, `allowedMoves`, `readDay`, `KIND_ORDER`, `compareEvents` from there |
| `apply` versus `refresh` (D9) | Fast-path `apply` when the event is later than every effective event on its day, has no correction/void/re-attribution around it, AND the event's resolved day equals the row's `work_date`. Any other case → `refresh` | The third condition is the easy miss (§9.3). A 06:30 punch-in that resolves to Monday would otherwise step Sunday's state machine over the row that still describes Sunday |
| Where the `apply`/`refresh` decision runs | Inside the projector's `apply(tx, userId, event)`. Attendance always calls `apply`; the projector decides itself whether to shortcut or fall back | Attendance already holds the person's advisory lock (§8.4 D24), which is the only place the "is this event later than every effective event on the day" question can be answered honestly |
| `status:changed` emit timing | After commit, from a `tx.onCommit`-style hook the projector queues. LS-8 mandates post-commit; a listener that ran on rollback would show a punch that did not happen | The DAL already exposes a post-commit hook (used by `outbox` and by earlier steps); reuse it |
| Rollover sweeper cadence | Every 5 minutes, keyed by the sweep slot so overlapping runs collapse (JB-1). Runs per-organization on the step-0 runner | §9.3: "at most one row per employee" indexed on `rollover_due_at`. Five minutes matches the design's stale-work rule |
| **How a person with no events yet gets a `user_status` row** | The rollover sweeper does TWO passes each tick: (a) **bootstrap** — find active users who have an `attendance_record` for today but no `user_status`, call `projector.refresh(userId, now)` per row; (b) **rollover** — the ordinary `rollover_due_at <= now` pass. Bootstrap owns the "new employee never punched" and "step 4 just deployed" cases. Neither day-open nor `attendance_record` writes to `user_status` directly | The projector must be the only writer (LS-9), and `appendEvent` is the fast path — but a person who has never generated an event still needs a `NOT_IN` row so the board doesn't omit them. Putting the backfill in the sweeper keeps LS-9 intact (the projector is still the sole writer) and gives the fix a self-owning schedule |
| Day-open ↔ live-status seam (LS-4 timing) | 3c's `openDay` (NOT `ensureDayRecord`) calls the registered `PresenceProjector.refresh` through the port, but only when the materialised date equals the person's current day. Historical catch-up skips the projector; today's materialisation refreshes it | The projector is a current-person projection. Refreshing on a historical materialisation would rebuild today's row from an old date; refreshing inside `ensureDayRecord` (which `applyOverlay` also uses) would fire BEFORE the overlay is written, producing `NOT_IN` instead of on-leave. The guard `date === currentDayFor(...)` in `openDay` puts the refresh in exactly one right place |
| Overlay ↔ live-status seam | `applyOverlay` / `removeOverlays` refresh the projector AFTER their overlay mutation, but only when the affected date is the person's current day. A future-dated leave writes the overlay and stops there; the live projection catches up when that day becomes current | Same reasoning as day-open: the projector is a current-person projection. A leave for two weeks from now must not change today's board state, and a leave for today must not update the board with `NOT_IN` because the projector ran before the overlay landed |
| Employee scope on the board | `own` — a person always sees their own row (implicit); every wider scope goes through the `userStatus` ResourcePolicy, which mirrors `userPolicy` | The board and the socket rooms MUST agree; a Task-9 test seeds a lead and asserts both APIs return the same set. Otherwise a lead's HTTP board and their socket-pushed board diverge |
| `attendance:view-live` action | Already in the registry seed; used by both the board and the socket channel | RT-5: the channel's `action` is what drives room membership |
| `likely_finished_at` (§9.1 "assumed" fields) | Set by the projector when the last effective event is a `scan` with `evidence = 'assumed'` on/after `shift_end_at`; cleared by any `evidence = 'confirmed'` event | The board's counts must exclude WORKING·assumed rows once the shift ends — otherwise a night crew who scanned out at 05:04 shows as still-working until 09:00 |
| `/today` endpoint | Not a new route; a `?self=true` variant of `GET /api/attendance/live` that returns the caller's one row plus `allowedMoves` and the two-moves-next-morning bit (§9.2). The frontend reads it once and subscribes to `status:changed` | The routes matter for the router boot check (RM-1); adding a separate `/today` binding when the shape is the same request is unnecessary. Screens are step 4's own frontend work, not this plan |
| Two-moves-next-morning (D30) | Computed in the response, not stored: when the caller's previous session is still open AND the next shift's opening window has begun, `allowedMoves` includes both the current day's `out` and the next day's `in`. Attendance's `currentDayFor` is what tells the endpoint whether both apply | Two buttons is the design, and the response is the API contract. Keeping the computation stateless means a mid-night refresh always shows the right thing |
| Node identity mapping for socket rooms | `attendance:view-live` at `own`/`team`/`department`/`pool`/`all-people` maps to the same rooms `rooms.ts` builds today. The `userStatus` policy filter uses the same axes | The plan's mandatory scope-agreement test runs both the HTTP filter and `viewerRooms` on the same fixtures and asserts the sets match |
| **Where the routing subject comes from** | `app_user.department_id` / `app_user.team_id` at emit time — the person's CURRENT placement, read fresh from `app_user`. NOT `attendance_record.placement_snapshot`, which describes the placement the day was calculated with | HTTP scope filters on the current placement (the `userStatus` policy joins `app_user u`); a socket subject built from the snapshot would go to the OLD team after a transfer, disagreeing with the board. The stored snapshot is right for the day's calculation history; the current placement is right for "who is allowed to see this person right now" |
| No write route on the board (LS-9) | Enforced by giving the `userStatus` resource NO management action | Any writer of `user_status` is the projector, called from within `appendEvent`. There is no manual "correct the board" surface — that would create a second, disagreeing state machine |
| Client work | Two things, both marked as follow-ups in the plan: Vite proxy needs `ws: true` on `/api`; the web client must reconnect the socket on `permissions:changed` and on token refresh | Step 0 set the server side up; step 4 puts it to use. Server tests do not exercise these — a UI smoke test does |

## Files

| File | What |
|---|---|
| `migrations/0055_user_status.sql` | The projection table (§9.3) with RLS, PK `(organization_id, user_id)`, rollover index, revoked writes for the app role |
| `packages/server/src/modules/live-status/state.ts` (+ test) | Pure helpers wrapping `presence.ts`: `deriveRow(events, window, shift)` returns the fields `user_status` stores. No I/O |
| `packages/server/src/modules/live-status/projector.ts` (+ integration test) | `apply` and `refresh`, both keyed on the person (D9). Decides fast-path vs. rebuild, writes `user_status`, queues the post-commit `status:changed` emit |
| `packages/server/src/modules/live-status/repository.ts` | SQL for `user_status`: `readRow`, `upsertRow`, `listBoard(visibility)`, `rolloverBatch(now)`, `lockRow(userId)` |
| `packages/server/src/modules/live-status/rollover.ts` (+ integration test) | The five-minute sweeper. Reads `rollover_due_at <= now`, calls `refresh(userId, now)` per row |
| `packages/server/src/modules/live-status/policy.ts` (+ test) | `userStatus` ResourcePolicy — mirror of `userPolicy`, filter joins `app_user u` |
| `packages/server/src/modules/live-status/routes.ts` | `GET /api/attendance/live`: board (default) or `?self=true` (own row + `allowedMoves`) |
| `packages/server/src/modules/live-status/channel.ts` | `definePeopleChannel({ name: 'status', action: 'attendance:view-live' })` and `emitStatusChanged(subject, payload)` |
| `packages/server/src/modules/live-status/today.ts` (+ test) | Computes `allowedMoves` + the two-moves-next-morning bit from a `user_status` row + `currentDayFor` |
| `packages/server/src/modules/live-status/jobs.ts` | Registers the rollover sweeper on the step-0 runner |
| `packages/server/src/modules/live-status/index.ts` | Registers the projector with `AttendanceFacade.registerPresenceProjector`, defines the channel, registers the policy, exposes `registerLiveStatusJobs` and `registerLiveStatusRoutes` |
| `packages/server/src/modules/index.ts` | Wires the three registrars |
| `packages/server/src/modules/live-status/punch-route.ts` (stub) | The G1-blocked route; imported nowhere until `status:punch` is added to the registry. Its handler is the two-line pass-through to `appendEvent`, unit-tested for the D10 rules attendance already enforces |
| `packages/server/src/modules/live-status/board.integration.test.ts` | Scope agreement + one-event-per-viewer. Uses the same seeds `rooms.test.ts` uses |
| `packages/server/src/modules/live-status/today.integration.test.ts` | `/today` shape and `allowedMoves` |
| `tools/ci/tables.ts` | Add `live-status` to `TABLE_OWNERS` for `user_status` |

(`platform/…` and `modules/…` are under `packages/server/src/`.)

---

## Task 1 — Migration 0055: `user_status`

- [ ] **Create** `migrations/0055_user_status.sql` — the design's SQL, verbatim,
  plus RLS and the revoked-writes stance:

```sql
-- =====================================================================
-- 0055 - user_status (§9.3): live-status's projection.
--
-- One row per person, whatever their current day is. The state machine
-- and the `apply`/`refresh` decision live in code; this table only stores
-- the last derived answer.
--
-- The app role has no write access at all: every writer is the projector,
-- called from within `AttendanceFacade.appendEvent`. There is no manual
-- correction surface (LS-9). REVOKE tightens the migration-0001 default.
-- =====================================================================

CREATE TABLE user_status (
  organization_id         uuid NOT NULL REFERENCES organization(id),
  user_id                 uuid NOT NULL,
  work_date               date NOT NULL,
  state                   text NOT NULL CHECK (state IN ('NOT_IN', 'WORKING', 'ON_BREAK', 'FINISHED')),
  since                   timestamptz,
  last_event_at           timestamptz,
  worked_minutes          integer NOT NULL DEFAULT 0,
  break_minutes           integer NOT NULL DEFAULT 0,
  presence_confidence     text NOT NULL DEFAULT 'confirmed'
                            CHECK (presence_confidence IN ('confirmed', 'assumed')),
  last_scan_at            timestamptz,
  last_scan_device        text,
  likely_finished_at      timestamptz,
  is_wfh                  boolean NOT NULL DEFAULT false,
  day_group               text CHECK (day_group IN ('leave', 'holiday')),
  shift_start_at          timestamptz,
  shift_end_at            timestamptz,
  window_start            timestamptz NOT NULL,
  window_end              timestamptz NOT NULL,
  rollover_due_at         timestamptz NOT NULL,
  grace_minutes           integer,
  flexible_target_minutes integer,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id),
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id)
);

CREATE INDEX ix_user_status_rollover ON user_status (organization_id, rollover_due_at);
CREATE INDEX ix_user_status_state    ON user_status (organization_id, state, work_date);

SELECT apply_tenant_rls('user_status');

-- LS-9: no route writes here. The projector is the sole writer, and it uses
-- the `system` role for its updates. Migration 0001 grants the app role
-- SELECT/INSERT/UPDATE/DELETE by default; tighten to SELECT only.
REVOKE INSERT, UPDATE, DELETE ON user_status FROM tapcrm_app;
```

- [ ] **Apply and reset the app role's password**, per the pattern established
  in steps 1–3:

```bash
npm run migrate
psql "$MIGRATION_DATABASE_URL" -c "ALTER ROLE tapcrm_app LOGIN PASSWORD 'tapcrm_local_secret';"
npm run ci
```

Expected: `0055_user_status.sql ... ok`, and `✓ CI-33 RLS on all 54 tenant-owned tables`.

Checkpoint: leave the changes in the working tree for review.

---

## Task 2 — The pure state helpers (`state.ts`)

`presence.ts` already gives `readDay`, `nextState`, `allowedMoves`,
`compareEvents`, `KIND_ORDER`. This task wraps them into the shape
`user_status` stores. Everything is pure — no `tx`, no I/O, no clock
except a `now` for `rollover_due_at`.

**`rollover_due_at` semantics.** It is the **next time the row needs
re-evaluation**, not the final cap of any session. The sweeper's
`WHERE rollover_due_at <= now` query is what selects rows for a
refresh, so putting the final cap here would starve rows whose state
must be checked earlier.

**Three separate instants matter, and they are not the same.** For a
20:00–05:00 night shift with a 4-hour closing extension:

| Name | Value in the example | What it is |
|---|---|---|
| `shift_end_at` | `05:00` | The scheduled end of the shift on this date (from the version) |
| `window_end` | `12:30` | The person's DAY boundary — the midpoint between this shift and the next (§5.2, §6.6). The day itself rolls here |
| `closing_cap` | `09:00` | The latest a still-open session may collect events; auto-close fires at this time (§5.2 §8.5) |

For a 09:00–18:00 day shift the three coincide almost by accident
(`shift_end_at = 18:00`, `window_end ≈ 01:30 next day`, `closing_cap`
depends on the extension). For a night shift they emphatically do
not. The rule uses the right name each time.

Rule:

| Situation | `rollover_due_at` |
|---|---|
| No session open, or session `FINISHED` | `window_end` — the person's DAY boundary; on the next tick the row rolls to the new day |
| A session is still open, and `now < shift_end_at` | `min(shift_end_at, window_end)` — first re-evaluation happens at the shift's end, when the session is either extending into overtime or has naturally closed. `min(…)` guards the rare case where a version's `shift_end_at` sits past its own day's window |
| A session is still open, and `now >= shift_end_at` (past shift end, session running long) | `min(closing_cap, next_shift_start)` — the refresh at `now` writes THIS value, so the next check is when the cap or the next day's opening would actually change the picture |

So the night worker's example, spelled out explicitly:

| Time | Event | `rollover_due_at` after |
|---|---|---|
| 20:00 | Punch-in — session open, `now < shift_end_at (05:00)` | `05:00` (`min(shift_end_at, window_end) = min(05:00, 12:30)`) |
| 05:00 | Sweep tick: `05:00 <= 05:00` → picked up. `refresh` sees the session still open and `now >= shift_end_at`, so rewrites the due time to `min(closing_cap, next_shift_start) = min(09:00, next-day 20:00) = 09:00` | `09:00` |
| 05:05, 07:00 | Sweep ticks: `09:00 <= 07:00` is FALSE → skipped | `09:00` (unchanged) |
| 09:00 | Sweep tick picks it up. `refresh` runs; `currentDayFor` may now hand back the new day; the row rolls, and `rollover_due_at` becomes the NEW day's `window_end` (the next boundary) | new day's `window_end` |

Contrast: if the same night worker had punched OUT at 04:45, `state`
would flip to `FINISHED` and `rollover_due_at` would jump to
`window_end = 12:30`. The day still rolls at 12:30 (the boundary
between last night and today), NOT at 05:00 (which is only the shift
end). This is exactly the case Task 5 test 2 covers: the row waits
for 12:30, not 05:00, to move to the new day.

The math is monotone: once `refresh` writes a future
`rollover_due_at`, no earlier sweep can select the row. Task 5 test 3
seeds this exact sequence — the sweep that actually picks up the
still-open row is at 05:01 (the first 5-minute tick after 05:00),
skips at 07:00, and picks up again at 09:00.

- [ ] **Write the test** — `packages/server/src/modules/live-status/state.test.ts`.
  Table-driven cases:
  1. Empty events (day-shift 09:00–18:00, window_end ≈ 01:30 next day) →
     `state: 'NOT_IN'`, `worked_minutes = 0`, `break_minutes = 0`,
     `rollover_due_at = window_end` (the row rolls at the day boundary).
  2. `[in@08:55]` at 08:55, session open, `now < shift_end_at` →
     `state: 'WORKING'`, `since = 08:55`, `worked_minutes = 0`,
     `rollover_due_at = min(shift_end_at, window_end)` — first
     re-evaluation is at the shift end.
  3. `[in@09:00, break-start@12:00, break-end@12:30, out@18:00]` at 18:01
     (session FINISHED) → `state: 'FINISHED'`, `worked_minutes = 510`,
     `break_minutes = 30`, `presence_confidence: 'confirmed'`,
     `rollover_due_at = window_end` — day rolls at the boundary.
  4. Night shift 20:00–05:00, window_end = 12:30. Events `[in@20:00,
     scan@05:02 assumed]` evaluated at 09:00. `now >= shift_end_at` and
     the session is still open → `state: 'WORKING'`,
     `presence_confidence: 'assumed'`, `last_scan_at = 05:02`,
     `likely_finished_at = 05:00 (= shift_end_at)`,
     **`rollover_due_at = min(closingCap, nextShiftStart) = 09:00`** —
     the closing cap, NOT `window_end` (which is 12:30).
  5. Same night shift, `[in@20:00]` at 04:59 (before shift end) →
     `state: 'WORKING'`, `rollover_due_at = 05:00`
     (`min(shift_end_at = 05:00, window_end = 12:30)`) — first check
     happens at the shift end; only after that do we move forward to
     the closing cap.
  6. Same night shift, closed by `[in@20:00, out@04:45]` (session
     FINISHED before shift end) → `state: 'FINISHED'`,
     `rollover_due_at = window_end = 12:30`. The day still rolls at
     the day boundary, NOT at shift end.
  7. `alternating` produces `evidence: 'assumed'` on every event
     (upstream concern; this test asserts `deriveRow` respects it).

- [ ] **Create** `packages/server/src/modules/live-status/state.ts` with
  `deriveRow(events, window, shift, now): DerivedRow`. Internally it reads
  the day with `readDay(events, window)`, walks its `steps` in order,
  sums `worked_minutes` and `break_minutes` from the step transitions,
  applies the LS-1 rules for `likely_finished_at` and
  `presence_confidence`, and computes `rollover_due_at` from the table
  above.

  Names of fields match `user_status` columns 1:1 so the repository upsert
  is a plain object spread.

  The `closingCap` and `nextShiftStart` inputs come from the caller;
  the pure helper takes them as parameters (no I/O in this file).

Checkpoint: leave the changes in the working tree for review.

---

## Task 3 — Repository: `user_status` reads and writes

- [ ] **Create** `packages/server/src/modules/live-status/repository.ts`.

  Uses the platform "system" role for writes (§9.3, LS-9). This role is
  what 3b's `recalculateRecord` and 3c's day-open write with — reuse the
  same DAL affordance (`db.systemQuery` or the equivalent name already in
  the repo; check `platform/dal/db.ts`).

  Exports:
  - `readRow(tx, userId): Row | null` — the app-role read.
  - `upsertRow(tx, row): void` — the system-role write. `INSERT ... ON
    CONFLICT (organization_id, user_id) DO UPDATE ...`.
  - `lockRow(tx, userId): void` — `pg_advisory_xact_lock(hashtextextended(
    'live-status:' || organization_id || ':' || user_id, 0))`. Same key
    space as attendance's `lockPerson` would be OK, but scoping to
    `live-status` avoids blocking a punch on a rollover sweep and vice
    versa (they touch different tables and different logical resources).
  - `listBoard(tx, visibility, at): Row[]` — the app-role read for
    `/api/attendance/live`. Joins `app_user u ON u.id = r.user_id` so the
    `userStatus` policy filter can target `u.department_id` / `u.team_id`
    (per Task 6).
  - `rolloverBatch(tx, now, limit): string[]` — the app-role read of user
    ids whose `rollover_due_at <= now`, up to `limit`.
  - `listMissingStatusUserIds(tx, today, limit): string[]` — the
    bootstrap query (Task 5): active users with an `attendance_record`
    for `today` but no `user_status` row.
  - `currentRoutingSubject(tx, userId): { userId, organizationId,
    departmentId, teamId }` — one query against `app_user` for the
    CURRENT placement. Used by the projector's emit path so socket
    routing agrees with the HTTP filter after a transfer (see Task 4
    docstring). Deliberately NOT sourced from the record's
    `placement_snapshot`.

Checkpoint: leave the changes in the working tree for review.

---

## Task 4 — The projector (`apply` + `refresh`)

- [ ] **Write the test** —
  `packages/server/src/modules/live-status/projector.integration.test.ts`.
  Cases:

  1. **Day-in-the-life fast path** — seed a person on the 09:00–18:00 day
     shift; call `appendEvent` for `in@09:00`, `break-start@12:00`,
     `break-end@12:30`, `out@18:00`. Assert `user_status` advances through
     `WORKING → ON_BREAK → WORKING → FINISHED` with correct `since`,
     `worked_minutes`, `break_minutes`. Assert one `status:changed` event
     is emitted per punch (via a socket spy).
  2. **`apply` falls back to `refresh` when the event changes the day** —
     seed a night worker whose last session is open at 06:30 the next
     morning; call `appendEvent` for `in@06:30`. Assert the row's
     `work_date` is now Monday (the pulled-forward day), NOT Sunday, and
     that the fields `shift_start_at`/`window_start` describe Monday.
  3. **`FINISHED` at the departure `readDay` books** — seed a person with
     two `out`s in the same second; assert `state = 'FINISHED'` and the
     `since` equals whichever `readDay` chose (D31, KIND_ORDER).
  4. **Undirected last-scan at shift end** — seed a night worker with a
     20:00 in and a 05:02 undirected scan; at 09:00 assert `state:
     'WORKING'` but `presence_confidence: 'assumed'` and
     `likely_finished_at = 05:00` (the shift end). Assert an ordinary
     board query counts this row under "possibly finished," not "working."
  5. **A `refresh` at 07:00 on a day with no punches** — seed a person
     with no events; the day-open row exists; `refresh(userId, 07:00)`
     writes `state: 'NOT_IN'`, `shift_start_at` set from the record's
     `window`. Idempotent — running twice writes the same row (dedup by
     `updated_at` or field equality; either is fine for this test).
  6. **Transfer invariance: an emit after a Team A → Team B move goes
     to Team B's viewers, not Team A's** — seed a person on Team A;
     seed an existing `attendance_record` for today built while they
     were on Team A (so `placement_snapshot.teamId = teamA`). Transfer
     the person to Team B (`UPDATE app_user SET team_id = teamB`).
     Seed Lead-A on Team A with `attendance:view-live` at `team` scope,
     and Lead-B on Team B with the same. Register a socket spy that
     records which rooms every emit lands in. Call `refresh(userId,
     now)`. Assert:
     - the `status:changed` emit landed in Team B's viewer room (a
       room containing Lead-B), NOT Team A's;
     - the `user_status` row was written (its content comes from the
       record's snapshot, which is fine — that's the day's history);
     - the routing subject the projector used came from `app_user`,
       not from `placement_snapshot`.

     This proves HTTP and socket agree through a placement change,
     which the ordinary scope-agreement test (Task 9) cannot catch
     because it seeds pre-existing rows.

- [ ] **Create** `packages/server/src/modules/live-status/projector.ts`
  implementing `PresenceProjector<Tx>`:

```ts
import type { AttendanceEventInput, PresenceProjector } from '@tapcrm/contracts';
import type { Tx } from '../../platform/dal/db.js';
import * as AttendanceFacade from '../attendance/facade.js';
import { deriveRow } from './state.js';
import { emitStatusChanged } from './channel.js';
import * as repo from './repository.js';

const projector: PresenceProjector<Tx> = {
  async apply(tx, userId, event) {
    await repo.lockRow(tx, userId);
    const row = await repo.readRow(tx, userId);
    const eventDate = await AttendanceFacade.currentDayFor(tx, userId, event.at);
    // §9.3 D9: fast path only when the event stays on the row's day, has
    // no correction/void/re-attribution around it, and is later than every
    // effective event on its day. attendance holds the person lock, so we
    // trust the second condition to be satisfied by the caller.
    const rowCurrent = row !== null && row.workDate === eventDate;
    if (!rowCurrent) return this.refresh(tx, userId, event.at);
    // Fast path — one step of the state machine using the day's events.
    const rebuilt = await rebuildFromEvents(tx, userId, eventDate);
    await repo.upsertRow(tx, rebuilt);
    // Routing subject comes from CURRENT app_user, not the record's
    // placement_snapshot. The board's HTTP filter uses current
    // placement (userStatus policy joins app_user u); the socket
    // subject must too, or an emit lands in the OLD team after a
    // transfer.
    const subject = await repo.currentRoutingSubject(tx, userId);
    tx.onCommit(() => emitStatusChanged(rebuilt.organizationId, subject));
  },
  async refresh(tx, userId, at) {
    await repo.lockRow(tx, userId);
    const today = await AttendanceFacade.currentDayFor(tx, userId, at);
    const rebuilt = await rebuildFromEvents(tx, userId, today);
    await repo.upsertRow(tx, rebuilt);
    // Routing subject comes from CURRENT app_user, not the record's
    // placement_snapshot. The board's HTTP filter uses current
    // placement (userStatus policy joins app_user u); the socket
    // subject must too, or an emit lands in the OLD team after a
    // transfer.
    const subject = await repo.currentRoutingSubject(tx, userId);
    tx.onCommit(() => emitStatusChanged(rebuilt.organizationId, subject));
  },
};

export function registerLiveStatusProjector(): void {
  AttendanceFacade.registerPresenceProjector(projector);
}
```

  `rebuildFromEvents(tx, userId, date)` reads the day's `attendance_record`
  (window, shift snapshot, day-type, overlays) and `effectiveEventsOf` for
  the same date, and hands both to `deriveRow`. Never re-resolves live
  through `shifts.resolve` — the record's `shift_snapshot` is the source
  (§8.1, mirrors 3c's day-detail rule).

  `tx.onCommit` is the DAL affordance already used by the outbox and by
  step 0's realtime. Reuse; do not invent.

Checkpoint: leave the changes in the working tree for review.

---

## Task 4a — Day-open calls the projector through the port (guarded)

3c's `openDay` currently ends after `writeRecalcRequested`. Add ONE
guarded call so a day materialised at 00:05 that is the person's
current day gets its `user_status` row right away (LS-4 timing). The
port already tolerates a null projector — this line is a no-op before
step 4 is deployed.

**The call lives in `openDay`, NOT in `ensureDayRecord`.** Two reasons:

1. **Day-open can be catching up historical dates.** When today is
   September 25 and `openDaysForOrganization` is materialising
   September 22, calling `refresh(..., clock.now())` would resolve
   September 25 via `currentDayFor` and needlessly rebuild today's row
   from a historical materialisation. `user_status` is a current-person
   projection; historical catch-up must not touch it.
2. **`ensureDayRecord` is also used by `applyOverlay`.** If we
   refreshed the projector there, we would refresh BEFORE the overlay
   itself is written — producing `NOT_IN` instead of the intended
   on-leave/WFH state until another refresh fires. Overlays refresh
   the projector AFTER their own mutation (Task 5 below).

The guard: only when `created` is true AND `date` equals the person's
current day (as `currentDayFor` reports it) do we call the projector.

- [ ] **Extend the test** in
  `packages/server/src/modules/attendance/day-open.integration.test.ts`:

  Register a fake projector whose `refresh` counts its calls. Cases:

  1. **Today, first materialisation** — `openDay(tx, userId, today,
     clock)` returns `{ created: true }`. Assert the fake's `refresh`
     was called with `(userId, clock.now())` exactly once.
  2. **Today, second materialisation** — a second `openDay` for the
     same (userId, today) returns `{ created: false }`. Assert the
     fake's `refresh` was NOT called this time (guarded on `created`).
  3. **Historical date** — with `clock` fixed at today, run `openDay`
     for `today - 3` (which is inside the employment window). Returns
     `{ created: true }`. Assert the fake's `refresh` was NOT called —
     the projector is a current-person projection.
  4. **No projector registered** — reset the projector via 3a's
     `__resetPresenceProjector`; `openDay` on today still works and
     writes the `attendance_record`, silently skipping the projector.

- [ ] **Edit** `packages/server/src/modules/attendance/day-open.ts`:

```diff
-import { addDays } from '../../platform/time.js';
+import { addDays, systemClock, type Clock } from '../../platform/time.js';
+import { presenceProjector } from './ports.js';
+import * as AttendanceFacade from './facade.js';
@@
 export async function openDay(
   tx: Tx,
   userId: string,
   date: DateOnly,
+  clock: Clock = systemClock,
 ): Promise<{ created: boolean }> {
   const { created } = await ensureDayRecord(tx, userId, date, { emitRecalc: true });
-  return { created };
+  if (created) {
+    await maybeRefreshProjector(tx, userId, date, clock);
+  }
+  return { created };
 }
+
+/**
+ * LS-4: give the board its NOT_IN row for TODAY now, not on the next
+ * 5-minute sweep. Guarded so historical catch-up (September 22 while
+ * today is September 25) does not rebuild today's row from an old date.
+ * A missing projector (before step 4 is deployed) is a no-op.
+ */
+async function maybeRefreshProjector(
+  tx: Tx,
+  userId: string,
+  date: DateOnly,
+  clock: Clock,
+): Promise<void> {
+  const projector = presenceProjector();
+  if (projector === null) return;
+  const now = clock.now();
+  const currentDay = await AttendanceFacade.currentDayFor(tx, userId, now);
+  if (date !== currentDay) return; // historical materialisation — not our concern
+  await projector.refresh(tx, userId, now);
+}
```

  `ensureDayRecord` itself is UNCHANGED — no clock parameter, no
  projector call. It stays a pure attendance mutation that other
  callers (including `applyOverlay`) can invoke without accidentally
  writing to `user_status` with the wrong day.

  The orchestrator (`openDaysForOrganization` from 3c Task 4) passes
  its runner-provided `clock` down when it calls `openDay`, so every
  scheduled day-open uses the same clock the rest of the run does.
  Historical fills inside that loop still respect the guard: only
  today's date triggers the projector.

Checkpoint: leave the changes in the working tree for review.

Checkpoint: leave the changes in the working tree for review.

---

## Task 5 — Rollover sweeper (`rollover.ts` + jobs.ts)

- [ ] **Write the test** —
  `packages/server/src/modules/live-status/rollover.integration.test.ts`.
  Cases:

  1. **Bootstrap: an active employee with an `attendance_record` but no
     `user_status` row is materialised as `NOT_IN`** — seed an active
     person. Insert the `attendance_record` for today directly via
     `platformDb` (skip 3c's `openDay`, because after Task 4a `openDay`
     itself calls the projector and would defeat the missing-row
     condition). Confirm no `user_status` row exists. Run the sweeper.
     Assert the row now exists with `state: 'NOT_IN'`,
     `work_date: today`, `shift_start_at` set from the record's window.
     This proves the board never omits a person who simply has not
     punched — the exact case a fresh employee or a fresh step-4
     deployment presents.
  2. **Night worker's row rolls at their DAY boundary, not their shift
     end** — seed a night worker with a 20:00–05:00 shift; a punch-out
     at 04:45 closes the session. `shift_end_at = 05:00` but
     `window_end (the day boundary) = 12:30`. Assert:
     - immediately after the punch-out, `state = 'FINISHED'` and
       `rollover_due_at = 12:30` (NOT 05:00);
     - at 12:00 (before the day boundary), the sweeper does NOT pick
       the row up (`12:30 <= 12:00` is false);
     - at 12:31 (past the boundary), the sweeper picks it up, calls
       `refresh`, and the row's `work_date` becomes the new day with
       `state: 'NOT_IN'`.

     This tests the distinction the terminology fix depends on: a
     `FINISHED` night worker rolls at their day boundary, not at shift
     end.
  3. **A row inside an extended session does not roll** — same night
     worker, but they have an in-progress session (`in` at 20:00, no
     `out` yet) whose `closing_cap` is 09:00. Initial `rollover_due_at`
     is `05:00` (`min(shift_end_at = 05:00, window_end = 12:30)`; see
     Task 2's `deriveRow` rule). NOT `12:30` — a still-open session
     needs a check at shift end, not the day boundary hours later. Run
     the sweeper at **05:01** (the first 5-minute tick after 05:00,
     when `05:00 <= 05:01` picks the row up). Assert: `refresh` was
     called; the row stays on the old day (the session is still open
     per `currentDayFor`); `state` remains `WORKING`;
     `rollover_due_at` is now `09:00` (`min(closingCap = 09:00,
     nextShiftStart = 20:00) = 09:00`).

     Then run the sweeper again at **07:00**. Assert `refresh` was
     NOT called — the row's `09:00 <= 07:00` is false, so the query
     skips it. The row is unchanged.

     Then run the sweeper at **09:00**. Assert `refresh` was called;
     the row rolls to the new day; `rollover_due_at` is the new day's
     window boundary. This proves the monotone-forward property: once
     `refresh` sets a future due time, no earlier sweep re-picks the
     row.
  4. **Idempotent bootstrap** — running the sweeper twice back-to-back
     when nothing has changed produces the same `user_status` row (no
     duplicate rows, `updated_at` may bump but every other field is
     identical). Regression guard for "bootstrap runs every tick."
  5. **The sweeper is scheduled every 5 minutes** — assert `jobs.ts`
     registers with `schedule: { every: 5 * 60 * 1000 }` and
     `perOrganization: true`.

- [ ] **Create** `packages/server/src/modules/live-status/rollover.ts`
  with `sweepRollovers(ctx, now, limit = 500)` that runs two passes,
  each per-user in its own transaction:

  ```ts
  // Pass A: bootstrap — active people who have an attendance_record for
  // today but no user_status row. `listMissingStatusUserIds` is a repo
  // helper: SELECT u.id FROM app_user u
  //   JOIN attendance_record r ON r.user_id = u.id AND r.work_date = $today
  //   LEFT JOIN user_status s ON s.user_id = u.id
  //  WHERE u.status = 'active' AND s.user_id IS NULL LIMIT $limit.
  const bootstrap = await db.transaction(ctx, (tx) => repo.listMissingStatusUserIds(tx, today, limit));
  for (const userId of bootstrap) {
    await db.transaction(ctx, (tx) => projector.refresh(tx, userId, now));
  }

  // Pass B: rollover — rows whose next re-evaluation point has passed.
  const due = await db.transaction(ctx, (tx) => repo.rolloverBatch(tx, now, limit));
  for (const userId of due) {
    await db.transaction(ctx, (tx) => projector.refresh(tx, userId, now));
  }

  return bootstrap.length + due.length;
  ```

  Small per-user transactions so one slow refresh does not stall the
  batch. Both passes call the SAME `projector.refresh` — LS-9 stays
  intact.

- [ ] **Create** `packages/server/src/modules/live-status/jobs.ts` and
  register the sweeper on the step-0 runner:

```ts
import { defineJob } from '../../platform/jobs/runner.js';
import { sweepRollovers } from './rollover.js';

export function registerLiveStatusJobs(): void {
  defineJob({
    name: 'live-status.rollover',
    perOrganization: true,
    module: 'live-status',
    schedule: { every: 5 * 60 * 1000 },
    attempts: 1, // next tick offers the same sweep; retries buy nothing
    handler: async ({ ctx, clock }) => {
      const n = await sweepRollovers(ctx, clock.now());
      return { itemsProcessed: n };
    },
  });
}
```

Checkpoint: leave the changes in the working tree for review.

---

## Task 5a — Overlays call the projector after their mutation (guarded)

3c's `applyOverlay` / `removeOverlays` currently end after bumping
`input_version` and writing `recalc-requested`. Add ONE guarded call
after the mutation so today's leave/WFH shows on the board immediately.
Same guard as Task 4a: only when the affected date equals the person's
current day, and only when a projector is registered.

Why after the mutation, not inside `ensureDayRecord`: the projector's
`refresh` reads the day's effective events and overlays through
`readDay`; if it ran before the overlay landed, it would see the old
state and produce `NOT_IN` where the answer should be on-leave.

- [ ] **Extend** `overlays.integration.test.ts` with three cases:

  1. **Today's overlay refreshes the projector after the overlay is
     written** — register a fake projector; call `applyOverlay` for
     today with `kind: 'leave-full'`. Assert the fake's `refresh` was
     called AFTER `attendance_overlay` was inserted. (Order: use a
     spy that snapshots the overlay-count when called; the count must
     be 1, not 0.)
  2. **Future-dated overlay does NOT refresh the projector** — apply a
     leave for `today + 3`; assert the fake's `refresh` was NOT called.
     The overlay row still lands (`attendance_overlay` count is 1);
     the projector catches up when that day becomes current.
  3. **`removeOverlays` refreshes only for affected dates that are
     current** — seed two overlays for the same person, one today, one
     tomorrow. Call `removeOverlays`. Assert `refresh` was called
     exactly once (for today), not twice.

- [ ] **Edit** `packages/server/src/modules/attendance/overlays.ts`:

```diff
+import { presenceProjector } from './ports.js';
+import { currentDayFor } from './ledger.js';
+import { systemClock, type Clock } from '../../platform/time.js';
@@
 export async function applyOverlay(
   ctx: RequestContext,
   input: OverlayInput,
+  clock: Clock = systemClock,
 ): Promise<void> {
   await db.transaction(ctx, async (tx) => {
     await ensureDayRecord(tx, input.userId, input.workDate, { emitRecalc: false });
     const inserted = await repo.upsertOverlay(tx, ctx.organizationId, { ... });
     if (!inserted) return;
     const record = await repo.findRecordByDate(tx, input.userId, input.workDate);
     if (record === null) return;
     await repo.bumpInputVersions(
       tx,
       ctx.organizationId,
       input.userId,
       new Set([record.id]),
     );
+    // LS-4: refresh the live projection AFTER the overlay is written,
+    // and only for today's overlay. A future-dated leave writes the
+    // overlay and stops here.
+    await maybeRefreshProjector(tx, input.userId, input.workDate, clock);
   });
 }
+
+async function maybeRefreshProjector(
+  tx: Tx,
+  userId: string,
+  date: DateOnly,
+  clock: Clock,
+): Promise<void> {
+  const projector = presenceProjector();
+  if (projector === null) return;
+  const now = clock.now();
+  const currentDay = await currentDayFor(tx, userId, now);
+  if (date !== currentDay) return;
+  await projector.refresh(tx, userId, now);
+}
```

  Apply the same guarded pattern in `removeOverlays`, iterating over
  the affected dates and calling `maybeRefreshProjector` once per date
  that matches the person's current day.

Checkpoint: leave the changes in the working tree for review.

---

## Task 6 — `userStatus` ResourcePolicy

- [ ] **Write the test** —
  `packages/server/src/modules/live-status/policy.test.ts`. Table-driven,
  same shape as `employee/policy.test.ts` and 3c's
  `attendance/policy.test.ts`. Cases per scope: `own`, `team`,
  `department`, `pool`, `all-people`, `none`.

- [ ] **Create** `packages/server/src/modules/live-status/policy.ts` — a
  near-copy of 3c's `attendanceRecordPolicy` (§8.7 rule "mirrors
  userPolicy"), with `resourceType: 'userStatus'`. Filter targets
  `app_user u`, so the caller must join `app_user u ON u.id = r.user_id`
  in `listBoard`.

  Register with `registerResourcePolicy(userStatusPolicy)` from
  `registerLiveStatusPolicies()`.

Checkpoint: leave the changes in the working tree for review.

---

## Task 7 — `/api/attendance/live` (board + `/today`)

- [ ] **Write the integration test** —
  `packages/server/src/modules/live-status/board.integration.test.ts`.
  Cases:

  1. **Scope filter** — seed HR (`all-people`), Lead (`team`), Employee
     (`own`). Seed `user_status` for six people across two teams. Assert:
     HR sees 6 rows; Lead sees 3 (their team); Employee sees 1
     (themselves).
  2. **Groups** — assert the response has counts for `working`,
     `possiblyFinished`, `onBreak`, `finished`, `notIn.due`,
     `notIn.notYetDue`, `onLeave`, `onHoliday`.
  3. **`?self=true`** — a caller with `own` scope hits
     `/api/attendance/live?self=true` and gets their one row plus
     `allowedMoves`. Verified against the same events seeded above.
  4. **AT-13 does NOT apply here** — this is a live snapshot, not a range.
     No 92-day limit.

- [ ] **Create** `packages/server/src/modules/live-status/routes.ts` with
  `GET /api/attendance/live` bound to `attendance:view-live`. The handler
  branches on `?self=true` (own-row-plus-moves) versus the full board.

- [ ] **Compose `/today`** in
  `packages/server/src/modules/live-status/today.ts`:

```ts
import type { DateOnly } from '@tapcrm/contracts';
import type { Tx } from '../../platform/dal/db.js';
import { allowedMoves } from '@tapcrm/contracts/presence';
import * as AttendanceFacade from '../attendance/facade.js';
import * as ShiftsFacade from '../shifts/facade.js';
import * as repo from './repository.js';

/**
 * D30 — "A night that was never closed does not block the morning." When
 * the caller's previous session is still open AND the next shift's opening
 * window has begun, offer ONLY the stale-session action set: `scan` and
 * `out` (to close yesterday's shift now — the departure will be flagged
 * unconfirmed for review) plus `in` (to start today's shift).
 *
 * Deliberately not `[break-start, scan, out, in]`: opening a break on
 * yesterday's forgotten session while today's shift is beginning is a
 * user-error waiting to happen, and would file the break on the OLD day
 * (attribution rule 3). §9.2's "Punch out" example is exactly this: give
 * two clear buttons, not four confusing ones.
 */
export async function loadToday(
  tx: Tx,
  userId: string,
  now: Date,
): Promise<{ row: repo.Row | null; allowedMoves: readonly string[] }> {
  const row = await repo.readRow(tx, userId);
  const currentDay = await AttendanceFacade.currentDayFor(tx, userId, now);

  // No row yet → the person can only punch in.
  if (row === null) return { row: null, allowedMoves: ['in'] };

  // A stale open session AND the new day's opening window has begun:
  // D30's explicit two-button set, not the state machine's full menu.
  if (row.workDate < currentDay) {
    const nextWindow = await ShiftsFacade.dayWindow(tx, userId, currentDay);
    if (nextWindow.start <= now) {
      // Yesterday's forgotten session is either WORKING or ON_BREAK.
      // Both need a way to close (`scan` or `out`), and today needs `in`.
      return { row, allowedMoves: ['scan', 'out', 'in'] };
    }
  }

  // Ordinary path: whatever the state machine allows.
  return { row, allowedMoves: [...allowedMoves(row.state)] };
}
```

- [ ] **Add the `/today` test** —
  `packages/server/src/modules/live-status/today.integration.test.ts`.
  Cases:
  1. Fresh employee (no row) → `allowedMoves: ['in']`.
  2. `WORKING` → `['break-start', 'scan', 'out']` (from `PRESENCE`).
  3. `ON_BREAK` → `['break-end', 'scan', 'out']`.
  4. `FINISHED` → `[]`.
  5. **Two moves next morning (D30)** — the night worker at 06:30 next
     morning with an open session (row `WORKING`, `workDate` = yesterday,
     `currentDay` = today, today's opening window has begun) sees
     **exactly** `['scan', 'out', 'in']`. NOT `['break-start', 'scan',
     'out', 'in']` — see the docstring above. The screen text names them:
     "End last night's shift" (scan/out) and "Start this morning" (in).
  6. **Same worker before the new day's window opens** — at 05:30, the
     new day's opening window has not begun. `allowedMoves` for a
     `WORKING` row is the ordinary set: `['break-start', 'scan', 'out']`.
     The D30 branch does not fire.

Checkpoint: leave the changes in the working tree for review.

---

## Task 8 — The `status` socket channel

- [ ] **Create** `packages/server/src/modules/live-status/channel.ts`:

```ts
import type { DateOnly } from '@tapcrm/contracts';
import { definePeopleChannel, emitAboutPerson } from '../../platform/realtime/server.js';

/** LS-8, RT-5. Registered at boot; RT-4: id-only payload. */
export const STATUS_CHANNEL = 'status';

export function registerStatusChannel(): void {
  definePeopleChannel({
    name: STATUS_CHANNEL,
    action: 'attendance:view-live',
    // Subject fields carry the person's current placement, so the room set
    // matches `userStatus`'s filter (see policy.ts). rooms.ts already
    // reads `departmentId` / `teamId` from the subject.
  });
}

/**
 * RT-4: id-only payload. Deliberately does NOT include state, workDate,
 * presence_confidence, or a change kind — a client that trusted those
 * would show stale board data (two events in flight, delivered out of
 * order, mean the last event's payload no longer matches the row). The
 * client's contract is "refetch the row on notification":
 *
 *   status:changed  { userId }  →  refetch /api/attendance/live for the
 *   scope, or /api/attendance/live?self=true for the own view.
 *
 * The subject's department/team routing info is what `emitAboutPerson`
 * uses to pick rooms; it is NOT in the payload the client sees.
 */
export interface StatusChangedPayload {
  readonly userId: string;
}

export function emitStatusChanged(
  organizationId: string,
  subject: {
    readonly userId: string;
    readonly departmentId: string | null;
    readonly teamId: string | null;
  },
): void {
  emitAboutPerson(
    organizationId,
    STATUS_CHANNEL,
    subject,
    'status:changed',
    { userId: subject.userId },
  );
}
```

  The socket payload is exactly `{ userId }`. Clients that want the full
  row hit `/api/attendance/live?self=true` (their own) or the board
  (their scope). This matches RT-4 word-for-word and cannot leak stale
  state through an out-of-order delivery.

- [ ] The projector's `tx.onCommit` in Task 4 now calls this. No new
  code beyond the wiring.

Checkpoint: leave the changes in the working tree for review.

---

## Task 9 — Scope-agreement test: the HTTP filter and the socket rooms match

The design's own words (roadmap step 4 "Check"):

> The `userStatus` resource policy must use the same people-scope rules as
> `platform/realtime/rooms.ts`, or the board and the API will disagree
> about who a lead can see. Add a test that runs both over the same
> fixtures.

- [ ] **Write** `packages/server/src/modules/live-status/scope-agreement.integration.test.ts`.
  For each of six scopes (`own`, `team`, `department`, `pool`, `all-people`,
  none):

  1. Seed HR, Lead, Employee. Seed 8 `user_status` rows across 2
     departments and 2 teams.
  2. As the caller for that scope:
     - Call `GET /api/attendance/live`; collect the returned user_ids →
       `httpSet`.
     - Simulate a socket connection: call `viewerRooms(channel, {…})` for
       the same caller and enumerate which of the 8 subjects hash into
       any of those rooms → `socketSet`.
     - Assert `httpSet.equals(socketSet)`.

  The test uses the same in-memory `channels` map that `server.ts`
  populates, and the same `rooms.ts` code the socket layer uses at runtime.

If a future edit makes the two diverge, this test fails at the seam that
matters and prints the offending scope.

Checkpoint: leave the changes in the working tree for review.

---

## Task 10 — Punch route (G1-blocked stub)

- [ ] **Create** `packages/server/src/modules/live-status/punch-route.ts`.
  The route is not registered yet; the file just defines the handler and
  the schema so the moment G1 is answered the diff is a one-line
  registration:

```ts
import { z } from 'zod';
import * as AttendanceFacade from '../attendance/facade.js';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { systemClock, wholeSeconds, type Clock } from '../../platform/time.js';

const punchSchema = z.object({
  kind: z.enum(['in', 'out', 'break-start', 'break-end', 'scan']),
  clientEventId: z.string().uuid(),
  clientTime: z
    .string()
    .datetime({ offset: true })
    .transform((s) => new Date(s))
    .optional(),
  location: z
    .object({
      lat: z.number(),
      lng: z.number(),
      accuracyM: z.number().optional(),
    })
    .optional(),
});

/**
 * Handler for the future POST /api/status/punch route. Deliberately thin
 * (§9.2 "Why the route is this thin"): idempotency by client_event_id,
 * validate shape, hand to `appendEvent` — which resolves the day, takes
 * the person lock, checks WFH / arrival policy / geofence under it, and
 * writes the event.
 *
 * Not registered here. Waiting on G1 (README question 3): the registry
 * does not yet declare a `status:punch` action, so `route()` would fail
 * the boot check.
 *
 * T-6: `occurred_at` is the server's whole-second receipt time via the
 * injected clock, ALWAYS. `clientTime` never controls it — it is stored
 * next to it as evidence (D13). `location` is passed through to
 * `appendEvent` so WFH-6 / ID-16 can evaluate against a real geofence
 * decision at §8.4 step 7; a missing `location` is `null`, which the
 * arrival policy handles for non-geofenced employees.
 */
export async function punch(
  ctx: RequestContext,
  body: unknown,
  clock: Clock = systemClock,
) {
  const input = punchSchema.parse(body);
  return db.transaction(ctx, (tx) =>
    AttendanceFacade.appendEvent(tx, {
      userId: ctx.principal.id,
      kind: input.kind,
      at: wholeSeconds(clock.now()), // T-6: server receipt time, whole seconds only
      source: 'web',
      evidence: 'confirmed',
      remote: true,
      clientEventId: input.clientEventId,
      clientTime: input.clientTime ?? null,
      location: input.location ?? null,
    }),
  );
}
```

  Two things to notice:
  - The `clock` parameter defaults to `systemClock` (step 0's injected
    clock, T-5). Tests pass a `fixedClock` and assert `occurred_at`
    equals it, proving `clientTime` never controls it.
  - `wholeSeconds` from `platform/time.ts` strips sub-second precision
    (T-6) before the value reaches `appendEvent` — matching the CHECK
    constraint on `attendance_event.occurred_at`.

  If `AppendEventInput` does not yet carry a `location` field, that is a
  small extension to `AttendanceFacade.appendEvent`'s input contract —
  the field flows through into the arrival-policy branch at §8.4 step
  7. Verify the exact field name against `ledger.ts`'s current type; the
  stub is the one place that carries it forward from the HTTP body.

- [ ] **Write a unit test** for `punch` that mocks `appendEvent` and
  asserts the handler:

  1. **Body validation** — rejects an unknown `kind` with a 400/422
     shape (whatever the router's zod error convention is).
  2. **`clientTime` never controls `occurred_at`** — pass a `clientTime`
     five hours in the past; pass a `fixedClock` at 12:00; assert
     `appendEvent` was called with `at` equal to `12:00:00Z`
     (whole seconds), NOT the client time.
  3. **Milliseconds are removed** — pass a `fixedClock` at
     `12:00:00.789Z`; assert `at` in the call is `12:00:00.000Z` (T-6).
  4. **`clientEventId` survives unchanged** — assert the exact UUID
     from the body reaches the mock.
  5. **`location` reaches the attendance layer** — pass
     `{ lat: 12.9, lng: 77.6, accuracyM: 30 }`; assert `appendEvent`
     was called with `location: { lat: 12.9, lng: 77.6, accuracyM: 30 }`.
     A separate case: no `location` in the body → the mock receives
     `location: null`.

  Full behaviour (WFH, arrival policy, geofence) is verified by the
  attendance ledger tests; this test proves the route is a thin
  pass-through and does not silently drop any of the three inputs
  attendance depends on (`at`, `clientTime`, `location`).

- [ ] **Document the G1 handoff** — add a `TODO(G1)` comment at the top of
  `punch-route.ts` naming exactly what changes when the action is added:
  add the route registration in `routes.ts`, no code changes to `punch`.

Checkpoint: leave the changes in the working tree for review.

---

## Task 11 — CI: `live-status` owns `user_status`; wire the module

- [ ] **Extend** `tools/ci/tables.ts`:

```diff
 export const TABLE_OWNERS: readonly {
   readonly module: string;
   readonly tables: RegExp;
 }[] = [
   { module: 'shifts',     tables: /^(shift|shift_[a-z_]+|department_shift_default)$/ },
   { module: 'holidays',   tables: /^(holiday|holiday_[a-z_]+)$/ },
   { module: 'attendance', tables: /^(attendance_[a-z_]+|arrival_policy_override|arrival_exception)$/ },
+  { module: 'live-status', tables: /^user_status$/ },
 ];
```

- [ ] **Extend** `tools/ci/tables.test.ts` with two cases: (a) `attendance`
  reading `user_status` is flagged, (b) `live-status` reading `user_status`
  is fine.

- [ ] **Register the module** in `packages/server/src/modules/index.ts`:

```diff
+import { registerLiveStatusPolicies } from './live-status/policy.js';
+import { registerLiveStatusRoutes } from './live-status/routes.js';
+import { registerLiveStatusJobs } from './live-status/jobs.js';
+import { registerLiveStatusProjector } from './live-status/projector.js';
+import { registerStatusChannel } from './live-status/channel.js';
@@
   registerAttendancePolicies();
+  registerLiveStatusPolicies();
+  registerStatusChannel();
+  registerLiveStatusProjector();
 }
@@
   registerAttendanceRoutes();
+  registerLiveStatusRoutes();
 }
@@
   registerAttendanceJobs();
+  registerLiveStatusJobs();
 }
```

  Order matters:
  - Register the projector BEFORE the first `appendEvent` can run (i.e. at
    boot, before HTTP or jobs start). `AttendanceFacade.appendEvent` is a
    no-op on the projector call when none is registered (3a's stub); once
    step 4 lands, the real one is in place.
  - Register the channel BEFORE sockets accept connections, so
    `roomsFor` sees the channel from the first handshake.

- [ ] **Build and check counts:** `npm run build && npm run ci`. Expect:
  - CI-2: **+1 binding** (`GET /api/attendance/live`); total moves from
    62 of 306 → **63 of 306**.
  - CI-10: **+1 resource** (`userStatus`); total moves from 13 of 63 →
    **14 of 63**.
  - CI-33: **RLS on 54 tenant-owned tables** (53 + `user_status`).
  - 17 checks pass.

Checkpoint: leave the changes in the working tree for review.

---

## Task 12 — Client-side follow-ups (not code in this plan, but named here)

The client work below is not test-driven from this plan; a UI smoke test
covers it. Named here so the team member doing the frontend knows exactly
what changes:

- [ ] `vite.config.ts` (client) — add `ws: true` to the `/api` proxy entry
  so websockets pass through in development. Step 0's server has been
  ready for months; this is the one line that turns it on locally.
- [ ] Socket client — reconnect on `permissions:changed` (the server closes
  the socket after telling the client, RT-3) and on the browser's
  token-refresh event. Both are one-line handlers that call
  `socket.disconnect()` then `socket.connect()`.
- [ ] `/company/today` screen — reads `/api/attendance/live?self=true`,
  subscribes to `status:changed` filtered to `userId === me.id`.
- [ ] `/company/workforce/live` screen — reads the board, subscribes to
  `status:changed`. The board's counts are what LS-2 says: a single
  indexed query per group.

None of this is on the server; the server side is complete without it.

---

## Task 13 — Final check

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
- CI-2 shows **63 of 306**, CI-10 shows **14 of 63**, CI-33 covers **54 tables**;
- the projector integration test's day-in-the-life passes;
- the scope-agreement test passes for all six scopes.

Then review the working tree (`git status`, `git diff`). Nothing has been
committed.

---

## What step 5 picks up from here

- **Device punches** land through `attendance.appendEvent` exactly the way
  web punches do; the projector Task 4 built runs for every one of them
  without change. Step 5's biometric pipeline just needs to call
  `appendEvent` with `source = 'device'` and the reader's evidence.
- **The clock-correction flow (§10.6)** uses the projector's `refresh`
  path when it retimes existing events — no new port; `refresh` is what
  it was built for.
- **`biometric.device-alert`** rides the same socket infrastructure this
  plan wires up; step 5 just needs its own `definePeopleChannel` or a
  device-admin channel, and the room routing is already there.

## Found while planning — raise with the owners

1. **G1 must land before pilot.** Nothing in this plan writes to
   `user_status` from an employee action, because employees have no way
   to punch until the registry declares `status:punch`. Devices (step 5)
   are also employees' punch source, and G7 is optional for their route.
   Both belong to the same conversation with the document owners.
2. **NF-2 load test.** The design commits to a punch appearing on 1,200
   connected boards within 3 seconds at 2,000 employees. This plan builds
   the shape that meets it (one indexed query per group, one emit per
   punch through the Redis adapter) but not the load rig. Line it up
   before go-live.
3. **LS-4 timing.** Once step 4 is deployed, 3c's `openDay` calls the
   registered `PresenceProjector.refresh` through the port, so `day_group`
   is set at 00:05 rather than waiting up to five minutes for the sweeper
   (see decisions table). Without this the design still holds — the
   sweeper's bootstrap pass would fill it in — but the delay could show a
   leave day briefly as `NOT_IN`. This adds one line to `openDay`: call
   `presenceProjector()?.refresh(tx, userId, now)` right after
   `writeRecalcRequested`. The refactor is small enough to land as part
   of this plan (Task 4a).
