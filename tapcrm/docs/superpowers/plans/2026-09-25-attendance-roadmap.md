# Attendance, Shifts, Biometric and Payroll — Roadmap

**Design.** `docs/superpowers/specs/2026-09-22-attendance-shifts-payroll-design.md`
(revision 23). Section numbers below (§…) are that document's.
**Detailed plans.** One per step, written when the step before it has landed,
so each plan is written against the code as it then is. Step 0's plan is ready:
`docs/superpowers/plans/2026-09-25-step-0-groundwork.md`.

Each step ships and is tested on its own (§0). Steps 0–7 are P1; steps 8–9 are
P2 (D1).

## Order at a glance

| Step | Builds | Needs | Blocked by | Plan |
|---|---|---|---|---|
| 0 | Groundwork: time helpers, job runner, outbox drainer, realtime, CI boundary fix | — | — | **Done** (in the working tree on `Archi`) |
| 1 | Shifts: templates, assignment, rotation, overrides, requests, one resolver | 0 | G3 (requests only), G14 (settings screens only) | **Done** (server). Screens (1b) not yet planned |
| 2 | Holidays and week-offs | 1 | — | **Done** (server): `2026-09-25-step-2-holidays.md` |
| 3 | Attendance core: events, daily record, calculator, recalculation | 1, 2 | — | **Done** (in the working tree): `2026-09-25-step-3a-attendance-ledger.md`, `2026-09-25-step-3b-attendance-calculation.md`, `2026-09-25-step-3c-attendance-api.md` |
| 4 | Punching and the live board (`live-status`) | 3 | **G1**; go-live needs **Q1–Q4** | Server milestone implemented; web punch checks/route, client and load verification remain (26 Sep scan) |
| 5 | Biometric: one device layer, ZKTeco ADMS first (the Identix) | 3 | **G2 for 5c only**; 5a/5b can proceed | **In progress:** prerequisite repair, 5a and 5b done (26 Sep); **5c device connection next, waiting for G2** — [2026-09-26-step-5-biometric.md](2026-09-26-step-5-biometric.md) |
| 6 | Leave and WFH overlays | 3 | — (leave numbers BD-5 block go-live) | After step 3, can run beside 4 and 5 |
| 7 | Corrections, auto-close and reconciliation | 3–6 | G8 for list/reject | **Core done** (28 Sep): `2026-09-27-step-7-corrections-autoclose.md`; named design follow-ups remain tracked below |
| 8 | Break management (P2) | 3, 7 | — | **Plan ready:** `2026-09-28-step-8-break-management.md` |
| 9 | Payroll (P2) | 3, 6, 7, 8 | G5, G6; statutory values (Q8, Q9) | After step 8 |

Steps 4, 5 and 6 each need only step 3, so once step 3 lands they can be
built in any order, or side by side.

**26 September code scan.** Step 4's projector, read API, rollover and outbox
wiring are present. Its unregistered punch stub does not yet enforce the
planned arrival checks, and the workforce client/socket work is absent. The
step 5 plan records these follow-ups, baseline verification failures and the
attendance retirement/replacement repairs needed for biometric duplicates.
It distinguishes backend implementation from end-to-end and go-live evidence.

**Ask for these now**, because they take longest to come back:

- From the document owners: G1 (blocks step 4), G2 (blocks step 5), G3 (step 1's
  requests).
- From HR: Q1–Q4 (block step 4's go-live) and Q11 (week-offs, needed for step
  2's seed).

---

## Step 0 — Groundwork (§5)

**Builds.** Date and time helpers around Luxon, with a `Clock` (§5.1). A general
job runner: `defineJob`, per-organization runs, `job_run` rows, retries, dead
letters and generations (§5.4). The domain outbox drainer, woken by NOTIFY with
a one-second poll (§5.5). Socket.IO with the Redis adapter, token-checked, with
rooms that follow scope (§5.5). The boundary check fix, the T-2 and T-4 CI rules,
the WFH local-date fix, and migration 0046 (§5.6).

**Done when** CI catches a sibling-module service import, a scheduled job
leaves a `job_run` row, and an outbox row reaches a connected socket in under a
second. Each has a named test in the step 0 plan.

**Moved out of step 0, deliberately:**

| Design item | Lands in | Why |
|---|---|---|
| §5.2 "Which day a punch belongs to" | Step 1 (`dayWindow`, the geometry) and step 3 (`attributeEvent`, `currentDayFor`) | It is a rule the shifts and attendance façades implement, not a platform piece |
| §5.3 shared types beyond `DateOnly` and `LocalTime` | Step 1 (`ResolvedShift`, `ShiftSource`, `HalfDays`) and step 3 (`EventKind`, `AttendanceEventInput`, `PINNED_REASONS`, …) | Nothing uses them earlier |
| §5.3 `contracts/src/presence.ts` (`PRESENCE`, `readDay`, `compareEvents`, `KIND_ORDER`) | Start of step 3, before the calculator | `appendEvent` and the calculator are its first users; its table is the one §9.1 fixes. Step 4's projector imports it from there |
| §2 problem 3 (P2 and P4 deny HR and payroll staff) | Step 6 (the leave-attachment loader sets `__holderIsHr`, §11) and step 9 (the payslip loader sets `__holderHasPayrollManage`, §14.8) | The flags are set by those loaders, which do not exist before then |

---

## Step 1 — Shifts (§6)

**Builds.** Tables `shift`, `shift_version` (versioned by effective date, D5),
`shift_assignment`, `shift_rotation`, `shift_rotation_day`, `shift_override`,
`shift_request`, `department_shift_default` and `shift_setting` (dated rows,
D35), with no-overlap constraints on `btree_gist` (from migration 0046). The
one resolver (SH-1, §6.2). `ShiftsFacade.resolve`, `dayWindow` and
`dayWindowContaining` — geometry only (§4, §5.2). SH-6 through a registered
constraint. API §6.4, screens and seed §6.5, night shifts end to end §6.6.

**Blocked by.** G3 for raising and listing shift requests (deciding them works
without it). G14 for the settings routes — until then, the go-live seed writes
the first `shift_setting` rows from HR's answers.

**From HR.** Q1 (full-day and half-day minutes per shift — required fields, no
default, D6), Q4 (grace per shift), Q13 and Q14 (night allowance and night
consent, §6.6).

**Done when** the explorer shows the right shift and source for any person and
date; a template edit changes nothing before its effective date; a past-dated
change by someone without `attendance:correct` is refused; and a 20:00–05:00
shift produces one day on its start date, with correct lateness, no double
counting, and the right month at a month end.

**Decided in the step 1 plan.**

- **No import cycle.** SH-6 and HO-3 would have called
  `AttendanceFacade.requestRecalculation`, while attendance imports the shifts
  and holidays façades, so the modules would have imported each other. Instead
  shifts writes a `shifts.days-changed` outbox event in the same transaction,
  and attendance's handler (step 3) refreshes day facts and queues the
  recalculation. Recalculation is queued anyway, so MB-3 is kept. Holidays
  does the same in step 2.
- **Split into server (1) and screens (1b).** Seeding the five Tapvera shifts
  waits for Q1 and Q4. Night-work consent and the rest warning wait for Q14,
  and arrive with the screens.
- **The rule-coverage check (§20).** Add the CI check that lists every SH, AT,
  LS, BI, LV, WFH, HO, BM and PY id no test title mentions, as a phased report.
  It becomes blocking when P1 ships.

---

## Step 2 — Holidays and week-offs (§7)

**Builds.** `holiday` and `holiday_scope` (typed scope columns, one set per row).
`CalendarFacade.dayType` (dated holiday, then week-off rule, then working day)
and `leaveDays`. `GET/POST/PATCH /api/holidays`. The seed: this year's holidays
and a Saturday + Sunday week-off rule, pending Q11.

**From HR.** Q11 (week-off pattern), and the year's holiday list.

**Done when** the calendar returns the right day type per person and date, and
declaring a holiday on a worked day marks it `holiday-worked` without removing
a single punch.

**Note.** The `holiday-worked` half needs attendance records, which arrive in
step 3. HO-3's recalculation goes through an outbox event, as shifts does (see
step 1). Its test is written here and passes once step 3 handles the event.

---

## Step 3 — Attendance core (§8)

**Builds.**

- **Tables (§8.1):** `attendance_event` (append-only; `GRANT SELECT, INSERT`
  only; whole seconds by `CHECK`, T-6), `attendance_event_assignment` (which day
  owns each event, and why — D23), `attendance_record` (one per person per day,
  D2, D3), `attendance_overlay`, `attendance_setting`, `arrival_policy_override`,
  `arrival_exception` and `attendance_day_open_state`.
- **Pure code:** `contracts/src/presence.ts`, then the calculator (§8.2) and
  status precedence (§8.3), table-tested with the order named in the AT-3 title
  (AT-I5).
- **`appendEvent` (§8.4)** under the per-person advisory lock (D24): attribute,
  check, append, re-attribute the neighbourhood, re-derive closures, bump input
  versions, call the `PresenceProjector` port, queue recalculation.
- **Recalculation (§8.5)**, keyed by record and input version, with generations.
- **Day-open (§8.6)** from the organization's watermark (D21).
- **API (§8.7)**, and the `effectiveEventsOf` helper (D28).
- **Façades:** `attributeEvent`, `currentDayFor`, `appendEvent`, `retireEvent`,
  `applyOverlay`/`removeOverlays`, `requestRecalculation`, `snapshotPeriod`,
  `openItems`.
- **Port:** `PresenceProjector` in `contracts`, with a no-op until step 4
  registers the real one.

**Jobs (§15).** Day-open (00:05 organization time, then forward from the
watermark), recalculate (on demand, keyed, with generations), stale sweeper
(every 5 minutes). All on the step 0 runner. Recalculation is queued by the
`attendance.recalc-requested` outbox event, never inside a transaction.

**CI added here.** The state-machine ownership check (§20): no transition table
or `PresenceState` literal outside `presence.ts`; `attendance` never imports
`live-status`; nothing sorts events with a comparator but `compareEvents`.

**Done when** a fixture month HR has prepared produces exactly the stored
records in the expected table HR signed off, and replaying any day — including
after voiding and restoring a punch — gives identical output.

---

## Step 4 — Punching and the live board (§9)

**Builds.** `user_status`, the projection (§9.3) implementing `PresenceProjector`.
The punch route `POST /api/status/punch` (§9.2): WFH, then arrival policy, then
geofence, all against the resolved day (D10). `/today` and the board (§9.4). The
`status` people channel — `definePeopleChannel({ name: 'status', action:
'attendance:view-live' })` — carrying `status:changed` (RT-5) with ids only
(RT-4).

**Blocked by.** **G1**: no registry action lets an employee punch, and an
unlisted route stops the server starting (RM-1). **Go-live** also needs Q1–Q4,
and Q6 (arrival policy).

**Jobs.** Presence rollover (every 5 minutes, keyed by slot).

**Client work that step 0 set up.**

- Reconnect the socket after `permissions:changed` (the server closes it, RT-3)
  and on token refresh.
- Add `ws: true` to the `/api` entry of the Vite proxy, so websockets pass
  through in development.

**Check.** The `userStatus` resource policy must use the same people-scope
rules as `platform/realtime/rooms.ts`, or the board and the API will disagree
about who a lead can see. Add a test that runs both over the same fixtures.

**Done when** web punching follows the arrival policy and WFH rules, a punch is
on a connected board within 3 seconds at 2,000 employees and 1,200 connections
(NF-2, load-tested), and a team lead's board holds exactly their team.

---

## Step 5 — Biometric (§10)

**Builds.**

- **Tables (§10.4):** `biometric_connector`, `biometric_device`,
  `biometric_reader`, `biometric_pin_mapping` (dated, no overlap),
  `biometric_punch` (with the reading stored when the punch arrives, D37) and
  the global `biometric_device_directory`.
- **One pipeline (§10.3)** with duplicate bursts judged by person and meaning
  (D33), and the ZKTeco ADMS adapter (§10.5).
- **Clock and health (§10.6):** offsets, and the clock-correction flow with the
  `retime-changes-subject` check (D38).
- **The machine surface** for `/iclock/*` and `/ingest/biometric/v1/*`.
- **Connecting the Identix (§10.9)**, with dry-run first. Its captured traffic
  becomes the parser's fixtures.

**Blocked by.** **G2 applies to 5c only**: the machine surface and global
directory need the document owners' sign-off. The tenant schema, six admin
APIs and tenant-context ingestion/replay pipeline (5a/5b) can proceed without
them. See the step 5 plan's explicit cross-device semantic burst decision,
which supersedes the design's older device/PIN partition. G7 (device commands,
punch import) blocks only those optional parts.

**Remember.** Add `biometric_device_directory` to `RLS_EXCEPTIONS` in
`tools/ci/index.ts` **and** to the exception list in the CI-33 step of
`.github/workflows/ci.yml` — the two must match.

**From HR.** Q7 (how old a punch may be and still apply — proposal 72 hours)
and Q12 (the go-live date, from which PIN mappings take effect).

**Jobs.** Device health (every 15 minutes), vendor pull (per connector), backlog
processing (on demand, keyed by punch). Device alerts go out as the
`biometric.device-alert` outbox event.

**Done when** the Identix runs on TapIt with every BI acceptance test passing
against its captured payloads, an unregistered serial is refused and logged,
no fingerprint or photo data is ever stored, and a device five minutes fast
produces no false lateness once its offset is set.

---

## Step 6 — Leave and WFH, as attendance sees them (§11)

**Builds.** `leave_type` (with `kind`: absence or attendance-mode for WFH),
`leave_request`, `leave_attachment`, `leave_balance_entry` (a ledger, LV-11).
Overlays through `applyOverlay` and `removeOverlays`, each pointing at its
request (L8). Standing WFH. The attachment loader sets `__holderIsHr`, which
fixes P4 — half of §2 problem 3.

**Open with the owners.** G9 (managers' acknowledgement list; optional-holiday
claims), G16 (a WFH day is judged by hours, not paid automatically). The leave
numbers (BD-5) are already a go-live blocker in the README.

**Jobs.** Acknowledgement timeout (hourly), standing WFH (daily, 60 days ahead).

---

## Step 7 — Corrections, auto-close and reconciliation (§12)

**Builds.** `attendance_correction` and the correction flow AT-6 to AT-11
(§12.1), with the database check for G4 (an approver may not approve a
correction to their own day). The review queue (§12.2). Auto-close as a
decision over the day's evidence (§12.3, D25), hourly, selecting by state and
due time, with generations and `auto-close-failed` after the third. Late
evidence re-derives closures inside the transaction that brought it (§12.4,
D27).

**Open with the owners.** G8 (a list route and a reject for corrections).

**Planning status.** The linked detailed plan's individual-correction,
grouped pending creation, auto-close and late-evidence core is reported done.
AT-11 atomic batch approval, G8 list/reject, biometric retime,
frozen/published reconciliation and the remaining review-item producers
remain separately tracked obligations with their owning steps and gates.

**Done when** a reviewer applies an employee's request while the original
device events stay visible as superseded; every day has exactly one current
closure; each late-evidence case in §12.4 — a late departure, a night delivered
after a no-show, a late scan after a shift-end guess, a lone late arrival —
produces the day it would have produced on time; and the TapCRM 17 August
sequence — two door scans seconds apart, then an app break — closes with one
punch-out after the break.

---

## Step 8 — Break management, P2 (§13)

**Detailed plan.** `2026-09-28-step-8-break-management.md` (implemented).
It moved the narrow `payroll_input` storage/writer forward for BM-10 while
leaving payroll runs and payslips in Step 9.

**Builds.** `break_policy` (versioned, BM-16), `break_penalty_rule`,
`break_policy_assignment`, and breaches. A breach's consequence is applied only
after a person confirms it, as an overlay, never by editing a punch (BM-5).
`BreakFacade.unresolvedBreaches` for payroll's publish gate.

**From HR.** Q2 (is break time paid when no policy exists — proposal: yes, D19).

**Jobs.** Break evaluation, hourly, selecting closed days whose evaluated
version is behind their calculation version (D21).

---

## Step 9 — Payroll, P2 (§14)

**Detailed plan.** `2026-09-28-step-9-payroll.md` (after Step 8). It adopts
the existing break-deduction input table, freezes the full monthly input set,
and gates publication on live drift and unresolved attendance/break items.

**Builds.**

- **Tables (§14.1):** `payroll_config` (ships empty; a named person accepts the
  values, D15), `salary_structure` and its lines, `payroll_run`,
  `payroll_run_employee`, `payslip`, `payslip_line`, `payslip_document`,
  `payslip_flag`, `ledger_posting_intent` (D16). Adopt `payroll_input`
  from Step 8 (BM-10); do not recreate it.
- **The flow:** run states (§14.2), the calculation in integer paise (§14.3,
  D14), the frozen snapshot (§14.4, D20), review (§14.5), publishing with its
  drift checks (§14.6), and revisions and flags (§14.7).
- **The P2 fix:** the payslip loader sets `__holderHasPayrollManage` (§14.8).
  This fixes the other half of §2 problem 3.
- **Flagging:** the `attendance.day-changed` outbox handler flags published
  payslips (AT-9).

**Open with the owners.** G5 (payslip and structure routes vs. the
`payrollRun` resource), G6 (ledger posting before `accounting` exists), G10
(the cycle overview route).

**From HR and the CA.** Q5 (late penalty — proposal: drop it, D18), Q8 and Q9
(statutory values and the PF wage), Q10 (overtime pay), Q13 (night allowance).

**Jobs.** Payroll generation (on demand, PY-10), payslip rendering (after
publish).

**Done when** a full cycle reconciles with attendance for every employee (the
PRD P2 exit), a published payslip cannot be changed by any principal including
Super Admin, and a correction after publication flags the payslip without
altering it.

---

## Everything the owners and HR must answer, by step

| Item | What | Needed by |
|---|---|---|
| G1 | A registry action and route for an employee to punch | Step 4 |
| G2 | The machine surface for device traffic, and the global device directory | Step 5 |
| G3 | `shifts:request` to raise and list shift requests | Step 1 (requests) |
| G14 | Attendance and shift settings routes; arrival exceptions | Step 1/3 (seed meanwhile) |
| G4, G8 | A correction's approver may not be its subject; list and reject corrections | Step 7 |
| G5, G6, G10 | Payroll resource bindings; ledger intents before P6; cycle overview | Step 9 |
| G7 | Device commands and punch import | Step 5 (optional parts) |
| G9, G16 | Acknowledgement list, optional holidays; WFH judged by hours | Step 6 |
| G11, G13, G15 | Wording of BI-4, BI-6 and BI-2 to match what the design does | Step 5 |
| G12 | Screen path prefixes | Already raised by access management |
| Q1–Q4 | Day thresholds, unpaid breaks, auto-close delay, grace | Step 1 (fields), step 4 go-live |
| Q6 | Must office staff scan to arrive | Step 4 |
| Q7, Q12 | Backfill age; go-live date | Step 5 |
| Q11 | Week-off pattern | Step 2 |
| Q13, Q14 | Night allowance; night consent | Step 1 (settings), step 9 (pay) |
| Q5, Q8, Q9, Q10 | Late penalty; statutory values; PF wage; overtime pay | Step 9 |

---

## Found while planning

Not covered by the design. Raise each when the named step is planned.

1. **Step 5 — a PIN is looked up on the punch's calendar date.** So is the
   employment check, and with real leaving dates (finding 6) this is live: a
   night worker's punch-out at 05:00 the morning after their leaving date is
   refused for review, although it closes their last shift. A night worker's last punch-out after midnight — on the
   day after their PIN mapping or employment ends — finds nobody, or finds the
   PIN's next holder. Decide whether the lookup should use the day the punch is
   attributed to, or allow a closing grace. Also: editing a PIN mapping with a
   past start date does not re-check punches already applied under the old
   mapping. Give those punches the same review route as `retime-changes-subject`.
2. **`access-management/overrides.integration.test.ts`: resolved (26 Sep).**
   The product code was right and the tests were out of date. One test
   granted to someone outside the lead's department. The other did not load
   the permission rules the app loads at startup, expected an old error, and
   counted an already-expired override as active. CI runs the file again.
3. **Step 1 — the recalculation import cycle:** decided, through an outbox event (see step 1 above).
4. **Step 4 — board and API must agree on scope** (see step 4 above).
5. **Steps 1 and 2 — the table privileges did not hold.** Migration 0001 gives
   every new table full access for the app role, and a `GRANT` cannot take it
   away, so 0047 and 0048 did not stop deletes or edits they were meant to
   forbid. Fixed by migration 0049 (step 3a, applied), and pinned by a test
   of every People table's privileges.
6. **Employment dates: added (26 Sep).** Migration 0060 puts a joining and a
   leaving date on the employee (both inclusive, both optional). HR sets them on
   `POST /api/users` (joining date) and `PATCH /api/users/:id`, which for now
   changes only these two dates. What attendance does with them:
   - A date outside the window gets no new day. A day that already exists and
     now falls outside is kept and marked `not-employed`. Moving a date re-judges
     the days it reaches, through the `employee.employment-changed` event.
   - Someone who becomes employed today after the morning's run gets today's day
     within the hour.
   - A device punch outside the window is refused for review.
   - A deactivated account with no leaving date gets no new days, but its past
     days keep their answer.
   - Days before a joining date that moves earlier are not created
     retroactively; they come in through corrections (step 7).
   - The add-employee form has a joining date field. Changing dates on screen
     waits for an employee edit screen; the API is ready. Finding 1's overnight
     rule now matters: see there.
7. **Step 3 — edges of a day without fixed times.** §5.2 defines `openFrom` and
   `closingCap` from a shift's start and end. For flexible and no-shift days,
   the step 3a plan uses the window's edges. Confirm with the owners.
8. **Step 3 — a past day and its department: resolved in the step 3b plan.**
   Each built day is judged with the department it recorded; the shift and
   holiday resolvers take those departments as an input. A transfer reaches
   the days built after it.
9. **Step 3 — shift and holiday changes that fail to arrive: resolved in the
   step 3b plan.** Those two events are retried until delivered, and each
   person's share becomes a refresh request the sweeper offers again until it
   is done. New alert to wire into paging: `outbox-event-overdue`.
10. **Now — `npm run lint` fails** on five errors already in the shifts and
    holidays code; `npx eslint --fix` fixes them (step 3b plan, "Found while
    planning"). A sixth is fixed by the step 3b plan.
11. **Step 7 — absent days.** Until auto-close lands, a working day nobody
    punched stays unjudged (no status) instead of "absent". Payroll must not
    run on a period before step 7.
12. **Deploy — signed download links.** Exports hand out 15-minute links to
    object storage. Set `S3_PUBLIC_ENDPOINT` if browsers reach storage at a
    different address from the server.
13. **Step 5 — the device-event key starts unvalidated.** Migration 0058 adds
    the key from `attendance_event` to `biometric_punch` as `NOT VALID`,
    because test databases hold device events from before it. Validate it
    (`ALTER TABLE attendance_event VALIDATE CONSTRAINT
    attendance_event_biometric_punch_fkey`) once a database has none.
14. **Step 5 — live mode is switched off in code** until 5c and real
    employment dates exist. Devices stay in dry-run (see the step 5 plan, §9).
15. **Queries side by side on one transaction: resolved (26 Sep).** A few
    places (shifts, holidays and others) started several queries at once on
    one connection, which pg@9 will refuse. The database layer now runs a
    transaction's queries one after another, in the order they were asked.
