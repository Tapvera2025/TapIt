# Attendance, Shifts, Biometric and Payroll — Design

**Date** 22 September 2026 · revision 23, 25 September 2026
**Modules** P1: `shifts` (H6), `holidays` (H9), `attendance` (H4), `live-status` (H3), `biometric` (H7), and the parts of `leave` (H8) that attendance reads · P2: `break-management` (H5), `payroll` (H10)
**Status** Final — revision 23, twenty review rounds applied, night shifts first-class (§22)
**Binding documents** `PRD.md` §9.3–§9.10, §15–§18 · `TECH.md` §3.1, §4, §5, §8, §9.3–§9.7, §11, §17, §18 · `AUTHORIZATION.md` §6.4, §6.5
**Names** *TapIt* is the product this repository builds; its PRD and TECH documents call it by its working name, TapCRM. *The old TapCRM* is the separate MERN system in `TapCRM/`. This design uses it only as a record of what not to do (§1) and for facts about the Identix terminal TapIt must support (§10.5); no code or data is carried over from it (§19). Where this document says TapCRM, it means the old system.

Where this document disagrees with those three, they win. The few places where
this design deliberately refines them are listed in §3 and raised with the
document owners in §17 rather than decided quietly.

---

## 0. In one page

**The flow.** Every source of a punch — a fingerprint or face terminal, a
vendor's cloud, the web app, the mobile app, an HR correction — ends in the same
place: one append-only list of events per person. One pure function turns a
day's events, that day's shift, and any leave or holiday into one stored daily
record. Screens, reports and payroll read only that stored record. Payroll
freezes a copy of the month before it calculates, and a published payslip never
changes.

```
 fingerprint / face / card ─┐                         ┌─► live board (user_status)
 vendor cloud / LAN agent  ─┤                         │
 web and mobile punch      ─┼─► attendance_event ─────┼─► socket "status:changed"
 HR correction             ─┘   (append-only)         │
                                      │               └─► recalculation queue
                                      ▼
            calculate(events, shift, leave, holiday, break decisions)   ← pure
                                      ▼
            attendance_record — one row per person per day, result stored
                                      ▼
            payroll run: frozen snapshot → payslip lines → publish → ledger
```

**Build order.** Each step ships, and is tested, on its own.

| Step | What | Phase | Needs |
|---|---|---|---|
| 0 | Groundwork: time helpers, job runner, outbox drainer, realtime, boundary-check fix | P1 | — |
| 1 | Shifts: templates, assignment, rotation, overrides, requests, one resolver | P1 | 0 |
| 2 | Holidays and week-offs | P1 | 1 |
| 3 | Attendance core: events, daily record, calculator, recalculation | P1 | 1, 2 |
| 4 | Punching and the live board (`live-status`) | P1 | 3, **G1** |
| 5 | Biometric: one device layer; ZKTeco ADMS first (the Identix in use today), other brands as adapters | P1 | 3, **G2** |
| 6 | Leave and WFH overlays | P1 | 3 |
| 7 | Corrections, auto-close and reconciliation | P1 | 3–6 |
| 8 | Break management | P2 | 3, 7 |
| 9 | Payroll | P2 | 3, 6, 7, 8 |

**Shift types.** Fixed (09:00–18:00), overnight (20:00–05:00) and
flexible-hours people all run through the same resolver, calculator, board and
payroll — no parallel night-shift path and no night-shift-only screens. §6.6
walks a night shift through every module.

**Before step 4 can start**, the document owners must settle three gaps in the
authorization document (§17, G1–G3) and HR must supply four numbers (§18,
Q1–Q4). Without G1 there is no route for an employee to punch at all, and a
route the manifest does not list stops the server from starting (RM-1).

---

## 1. What the old TapCRM taught us

The scan of the old TapCRM (`TapCRM/ATTENDANCE-SYSTEM-SCAN.md`, 22 Sep 2026)
found that most problems came from three habits: rules living in screens
instead of the server, side doors around the one correct path, and two copies
of the same logic. Nothing is carried over from it. Each row turns one of its
mistakes into a rule TapIt enforces, and says what enforces it — a database
constraint, a pure function, the authorization engine, or a test.

| # | Old TapCRM finding | TapIt rule | Enforced by |
|---|---|---|---|
| L1 | "Fingerprint-only arrival" was a hidden button; the API still accepted app punch-ins from anyone | Arrival policy is server configuration (D10). Under the PRD default, a web punch-in on a non-WFH day is accepted but flagged *worked remotely without an approved request* (WFH-6), and payroll cannot publish until HR reviews it (PY-7); under `device`, it is refused and the person is sent to the terminal | punch service, review queue, publish gate |
| L2 | Any punch paid as a full day; fixed 4 / 4.5 / 7.5 h for every shift | Full-day and half-day minutes come from the day's shift (fixed) or SH-4 (flexible). There is no product-wide constant | `calculate()`, `NOT NULL` shift columns |
| L3 | Two salary screens paid ₹39,850 and ₹27,863 for the same month | One payslip calculator (NF-20); payroll reads only stored attendance (AT-1) | module boundary, CI |
| L4 | Saved "total deductions" left out the late amount | Totals are sums of lines; `net = gross − deductions` is a database check | `CHECK`, publish trigger |
| L5 | Auto-close looped every hour for a week | Auto-close is a decision over the day's evidence: at most one current system punch-out, never earlier than the day's last event, recomputed only when that evidence changes — never on a timer; a failing run gets bounded retries per input version and at most three daily generations, then the day is flagged for a person | job key, rule, test |
| L6 | Old open days never closed (7-day lookback) | Auto-close selects by state and due time, never by lookback | query, partial index |
| L7 | No leave balances; self-approval; employees deleted approved leave; medical notes visible to all | LV-2, LV-7, LV-11, P4; approved leave is cancelled through HR, never deleted | engine (A1, P4), DB checks |
| L8 | Leave stamped on a day without a request id, so revoking it left it in force | Every overlay row points at the request that made it; cancelling removes exactly those rows | foreign key, façade |
| L9 | Device endpoint had no secret and no IP check; serial and PIN shown to employees | Registered serial, per-device IP allowlist, token where the firmware supports it, backfill limit; attendance APIs never return a serial or a PIN | device middleware, API shape |
| L10 | The handshake asked the device to upload fingerprint templates and photos | Ask only for attendance and operation logs; drop any template or photo line unread (DP-2) | handshake builder, parser test |
| L11 | `TimeZone=5.5` and a double 30-minute offset shifted every punch | Timezone and offset are per-device settings; the handshake value is derived (`330` for IST); skew is measured and alerted (BI-4) | device config, health job |
| L12 | Auto-close booked raw device time while arrivals used corrected time | The corrected instant is computed once at ingest and stored; everything downstream reads it | `biometric_punch.corrected_at` |
| L13 | Shifts drove only lateness — not early exit, overtime or thresholds | The day's shift snapshot drives lateness, early exit, overtime and thresholds; week-offs come from the calendar | `calculate()` |
| L14 | Employees could recalculate their own past days with today's shift | Recalculation uses the stored snapshot; a past shift change needs `attendance:correct` (SH-6) | engine, service |
| L15 | Five places held shift data, with no effective dates | One resolver (SH-1) over versioned templates and dated assignments | resolver, exclusion constraints |
| L16 | One document per date for the whole company; concurrent saves collided | One row per person per day (`ux_attendance_day`), locked per person | schema |
| L17 | Every read recalculated and discarded the result; four copies of the day classifier | Reads never recompute (AT-1); the client shows server values only | API contract |
| L18 | HR edits deleted device events | Events are append-only; a correction appends and supersedes (AT-6) | `GRANT SELECT, INSERT` only |
| L19 | Date keys built with `toISOString()` read the previous day before 05:30 IST | Day boundaries come only from the shifts façade in the organization timezone; CI rejects `CURRENT_DATE` and ISO-string date keys in People modules | CI rule |
| L20 | A hidden "speed factor" multiplied recorded break time | Nothing is monitored or scaled silently (DP-7); the model has no multiplier | design, review |
| L21 | Half-day leave credited 0.5 even when the other half was worked | A day is split into half-day units — present, paid leave, unpaid leave, absent, holiday — that must add up to one day | `CHECK` |
| L22 | Weekends unpaid on one screen, paid on another | PY-2: paid days = total days − loss of pay; week-offs and holidays are paid | payroll calculator |
| L23 | No leaving date; leavers dropped off their final month | Payroll prorates by the employment window | payroll calculator |
| L24 | Nothing froze a month; published payslips were edited, deleted, regenerated | Frozen snapshot per run (PY-1); published rows never change (A3, PY-5); later changes flag the payslip | snapshot, trigger, flag table |
| L25 | Cron in every process; no run history; 49 data-repair scripts | BullMQ schedulers, `job_run` records, idempotent keys (JB-1..JB-4); replay and recalculation are audited product features | platform jobs |
| L26 | No test runner wired | Every numbered rule has a named test (NF-23); calculators are table-tested | CI |

---

## 2. What exists in TapIt today

Checked against the code on 22 and 25 September 2026, not assumed.

| Thing | Where | State |
|---|---|---|
| People module keys | `migrations/0005` | Present. Dependencies only point at `employee-directory`; the PRD §5.8 chain (attendance → shifts, payroll → attendance + leave + breaks, …) is missing |
| `work_from_home_day` | `migrations/0023` | One row per approved WFH date; read by the login geofence |
| Organization timezone | `organization.timezone`, default `Asia/Kolkata` | Present (NF-15) |
| Service accounts | `migrations/0002`, `identity/service-accounts` | Hashed, expiring credentials with IP allowlist and rate limits |
| Pre-authentication directory | `identity_email_directory` (`migrations/0024`) | The precedent for finding a tenant before a request context exists |
| Route binding and manifest check | `platform/http/route.ts`, `router.ts` | Done. An unlisted route stops boot (RM-1) |
| Resource type check | `authz/src/engine.ts:155` | The loaded resource's `type` must equal the action's registry resource |
| P2 and P4 constraints | `authz/src/constraints/privileged.ts` | Implemented; they read `__holderHasPayrollManage` and `__holderIsHr`, which nothing sets yet |
| Module-registered constraints | `registerConstraint`, `holdsPolicy` exported from `@tapcrm/authz` | Available (used here for AT-10 and SH-6) |
| Job scheduler | `platform/jobs.ts`, `job_run` (`migrations/0003`) | One BullMQ queue and worker, switching on the job name, with four daily maintenance jobs scheduled through `upsertJobScheduler` — geofence purge, access-override expiry audit, audit-chain verification, audit retention. The audit jobs write `job_run`. There is no general runner: no per-job keys, no dead-letter handling, no per-organization context helper |
| Domain outbox | `domain_outbox` table | The positions module writes to it; nothing drains it |
| Realtime, files, notify | `platform/realtime`, `platform/files`, `platform/notify` | Empty folders |
| People registry actions | `AUTHORIZATION.md` §6.4 | Present for attendance, breaks, shifts, biometric, leave, holidays, payroll. **None for `live-status`** (README question 3) |
| Dates and money helpers | `contracts/src/money.ts` | `Decimal` branded string exists; no arithmetic; no date library in `server/package.json` (Luxon is in the lockfile only through `cron-parser`) |

**Problems found while reading — fixed in step 0:**

1. **The module-boundary CI check misses sibling imports.** Its pattern only
   matches paths that contain `modules/`, so
   `from '../identity/password/service.js'` passes. `employee/service.ts` and
   `employee/routes.ts` reach into other modules six times today — four of them
   `service` files. The People modules add many cross-module calls, so this gate
   must work before they land.
2. **The geofence WFH check uses the database's date.**
   `identity/geofence/service.ts:17` compares `work_date = CURRENT_DATE`. The
   database session timezone is not set (the Postgres image defaults to UTC), so
   between 00:00 and 05:30 IST it checks yesterday's WFH approval.
3. **P2 and P4 would deny HR and payroll staff** until the payslip and leave
   attachment loaders set the holder flags.
4. **Catalog dependencies** need the PRD §5.8 rows, so enabling `payroll` also
   enables `attendance`, `leave`, `break-management` and `shifts`.

---

## 3. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | Steps 0–7 are P1, steps 8–9 are P2, in the order in §0 | PRD §18 and the §5.8 dependency column |
| D2 | One row per person per day; events append-only; the calculated result is stored and never recomputed on read | AT-1, AT-6; TapCRM L16–L18 |
| D3 | Every employee gets a row for every day, even with no punches | Absence becomes a stored fact that payroll counts, not an inference from missing data |
| D4 | Three separate questions, never one window: the **day window** (shift geometry, owned by `shifts`), **event attribution** (the midpoint, overridden by three session-aware rules checked in a fixed order — the next shift's claim, the day's own claim, the previous session's closing extension — owned by `attendance`, stored per event), and the **eligibility window** (what may count as working time, not clipped to the day window). A day with no fixed times borrows an anchor rather than falling back to midnight (§5.2, §8.1, §8.2) | The TECH §9.4 sketch files a punch-out after an overnight shift's end, and a day-shift punch-out after midnight, under the next day; a plain midnight fallback brings that back whenever the next day is flexible |
| D5 | Shift templates are versioned by effective date; an edit creates a new version | SH-2 without relying on snapshots alone; answers "who was on which shift when" |
| D6 | Fixed-shift full-day and half-day minutes are required fields on each shift version, with no product default | The PRD fixes only flexible (SH-4); TapCRM's constants caused L2. HR supplies the numbers (Q1) |
| D7 | A day's credit is stored in half-day units: present, paid leave, unpaid leave, absent, holiday — always summing to 2 | PY-2 becomes a sum; fixes L21 |
| D8 | Recalculation is queued and keyed by person, date and input version | AT-I4, without the "trigger arrives while the job is running" race (§8.5) |
| D9 | `attendance` owns events and records; `live-status` owns the live projection and registers a projector port that attendance calls in the same transaction. The projector is a function of **(person, now)** — never of a record id — and it touches `user_status` only for the day the person is in right now | LS-1 needs one transaction; corrections, replays and backfilled punches arrive out of order, and a projector keyed on "whichever day changed" would write last week's `FINISHED` over today's `WORKING` |
| D10 | Arrival policy is configuration: `device-or-web` (PRD default) or `device` (office staff must scan to arrive). The punch checks WFH, then the arrival policy, then the geofence — in that order | Carries TapCRM's intended rule into the server (L1); ID-15c says a geofence alone is not an attendance control, so passing the fence must not be a way around the policy |
| D11 | Biometric is one ingest pipeline with many adapters; the first adapter is ZKTeco ADMS | "Work with any device" without a second code path per brand (NF-20) |
| D12 | Device traffic uses a machine surface outside the product router, with its own device authentication and a global serial directory | Terminals cannot send a user token and their paths are fixed by firmware; needs owner sign-off (G2) |
| D13 | A web or mobile punch is stamped with the **server's** receipt time, always. A client's own time is stored beside it as evidence, and a gap beyond the tolerance opens a review item carrying the claimed time | NF-19 wants offline punches to sync, but a client-supplied instant is a client-chosen arrival time; a reviewer applies it as a correction instead |
| D14 | Payroll money is integer paise with half-up rounding once per component | PY-3, PG-5; no floats and no new dependency |
| D15 | `payroll_config` ships empty; statutory values are entered and accepted by a named person; a run will not start without them | SD-2's reasoning ("guessing a GST rate is a statutory problem") applies equally to PF, ESI and PT |
| D16 | Ledger posting goes through `LedgerFacade`; until `accounting` exists the façade stores a balanced posting intent in the same transaction | PY-11 is P2 but accounting is P6 (G6) |
| D17 | Published payslip rows are never updated; documents, flags and revisions live beside them | A3, PY-5; TapCRM L24 |
| D18 | No late-arrival money penalty unless the owners add a PRD rule | PY-2 limits loss of pay to unpaid leave and unapproved absence; TapCRM's "3 lates = 1 day" has no PRD basis (Q5) |
| D19 | With no break policy, break time is not deducted from worked time | BM-0: breaks are recorded but not governed; HR confirms (Q2) |
| D20 | A payroll run computes **only** from its snapshot — attendance days with their calculation versions, the employment window, salary structures and their lines, payroll inputs and the config version — and the publish transaction re-reads those versions from the database before it commits | PY-1 means frozen, not "frozen except what a parallel job reads later"; an asynchronous "inputs changed" marker can lose a race with publish |
| D21 | Anything derived — the live projection, a day's closure, break evaluation, month summaries — can be rebuilt from stored inputs, and every sweeper selects by **state**, never by "what happened in the last hour" | An outage must not leave work permanently unprocessed; this is the auto-close lesson (L5, L6) applied everywhere |
| D22 | Every cross-module event is delivered **at least once** with a stable event id; consumers are idempotent | An outbox row can publish and then fail to be marked processed |
| D23 | Which day owns an event is **stored** in `attendance_event_assignment` with its reason, and rebuilt across the neighbourhood — three days, widened when an outer day changes — whenever a change could alter session openness; a pinned assignment is never moved | Attribution stopped being a pure function of a timestamp the moment it became session-aware. A derived, rebuildable mapping keeps replay honest and makes "why is this punch on Sunday" answerable |
| D24 | Every punch, correction, replay and re-attribution takes a transaction-scoped advisory lock on the person before it attributes anything; one that touches several people takes all their locks first, in ascending user-id order (§8.4) | The row to lock is not known until attribution has run, so a row lock alone cannot serialise two concurrent punches for the same person. Two transactions that each took the same two people's locks in their own order could deadlock; one fixed order makes the second simply wait |
| D25 | **A day's closure is derived, never recorded as a fact.** Auto-close's answer — no-show, or a departure taken from the last scan, the shift end or the last event — is a function of the day's real events, applied again whenever they change. A system `auto-out` never counts as a departure for attribution, and an answer that changes retires the old `auto-out` with an append-only void row (§5.2, §12.3, §12.4) | Otherwise the day a person worked depends on when their terminal reconnected — for a late punch-out, and equally for a late arrival after a no-show or a late scan after a shift-end guess. Deriving the closure makes the result a function of the punches alone, which is what the late-delivery property test checks |
| D26 | The presence state machine is declared once in `packages/contracts/src/presence.ts` and imported by both `attendance` and `live-status`; neither declares a transition of its own, and CI enforces it | `attendance` validates moves and `live-status` projects them, and `attendance` may not import `live-status`. A pure transition table has no owner, so it belongs with the other shared domain types — not duplicated, not injected as a port (§5.3, §9.1) |
| D27 | A late punch is appended and the day's closure re-derived **even inside a frozen or published payroll period**. Payroll is protected by its snapshot, the publish gate and the payslip flag — never by refusing to record what happened (§12.4, §14.4) | Holding evidence would make attendance deliberately wrong for as long as a queue took to clear, and would be a second, contradictory rule beside the one corrections and retroactive leave already use |
| D28 | **Effective events are the tails of append-only supersession chains.** An event is effective only when it is not a void row and no ledger row names it in `supersedes_event_id`; one repository helper, `effectiveEventsOf`, supplies attribution, session-open checks, calculation, closure decisions and presence replay (§8.1) | Corrections and reconciliation both supersede events. One definition prevents the calculator, the projector and attribution from disagreeing about whether an `auto-out`, a replacement or a tombstone still counts |
| D29 | Every event carries its **evidence** — `confirmed` or `assumed` — stamped once when it is recorded — from the channel and, for a device punch, from the reading its raw punch was given when it arrived (D37) — and never re-derived from configuration (§8.1, §9.1, §10.4) | The calculator's overtime rule, the board's confidence and the closure decision all depend on it. Looking it up from today's reader settings would let a settings change rewrite history, and without it an `alternating` reader's `out` is indistinguishable from an exit reader's |
| D30 | **Once the next shift has started, the previous session stops collecting events.** An arrival — an `in` from any channel, or a scan — inside the next shift's opening window starts the next day even if the previous session was never closed; the previous day is flagged and its departure comes from its own evidence (§5.2) | Forgetting to punch out is the commonest attendance error in a rotation. Without this, the next morning's web punch-in is refused, and the only way through is a punch-out that invents hours of confirmed overtime |
| D31 | **One arrival and one departure per day**: the first eligible `in` or `scan`, and the first eligible `out` or `auto-out` after it, in the order of D32. Attribution's openness test, `closeDecision`, the calculator and the state machine all take them from one reading of the day, `readDay`; anything after the departure is evidence, never time (§5.3, §8.2) | The state machine ends a day at its first `out`. A calculator taking the last `out` would let a double exit swipe add minutes the board never showed, and a closure ignoring the eligibility window would accept a punch-out five hours after a night as its departure. A later departure is recorded by a correction, which the supersession chain already handles |
| D32 | **One order for a day's events, down to the second.** Instants are whole seconds (T-6). Events are read by instant and, within one second, by kind: `out`, `in`, `scan`, `break-start`, `break-end`, and a system `auto-out` last. Events of one kind in one second are one piece of evidence. Attribution, `readDay` — and through it arrival, departure, breaks, `replay`, the calculator and `closeDecision` — the projector's fast path and the interactive check all use this order; nothing is ordered by id or by when a row was written (§5.2, §5.3) | Two helpers comparing times their own way let an `in` and an `out` both stamped 09:00:00 give the calculator no departure while the board showed `FINISHED`. Reading `out` first means an `out` can never be the departure of an arrival in the same second — it is kept and flagged for review, `same-instant-conflict` on the arrival's day — and at a handover the night's `out` closes it before the morning's `in` opens the next day. A tie broken on ids would depend on which row happened to be written first, which is delivery order by another name |
| D33 | **A duplicate is the same punch twice, judged by person and meaning (BI-6).** A re-send is recognised by the source's own event id, or by device, reader, PIN, the device's own clock reading and status key. Separately, punches from one device and PIN, **mapped to the same person, with the same meaning** — entry, exit, a mapped key, or a plain scan — each within 60 seconds of the previous one, collapse to the earliest; different meanings and different people never collapse, and the earliest wins whatever order they arrive in. The person is found before the check, so a punch without one joins a burst only when it is replayed (§10.3) | BI-6 was written for a one-reader terminal, where "same PIN, same device, within 60 seconds" can only be a double tap. An access controller's entry and exit readers are one device, and a person who walks in and straight back out would lose the exit. A PIN mapping is dated, so one number can pass from one person to the next at midnight; judged before the person is known, one holder's last scan would swallow the next holder's first. Keeping the earliest, even when it arrives last, keeps the result a function of the punches rather than of their delivery (G13) |
| D34 | **Every link between two of one person's rows names the person.** Where both rows belong to someone, the foreign key includes `user_id` on both sides: an event and the day it is assigned to, an event and the event it supersedes, a device event and its raw punch, a duplicate punch and the punch it repeats, a correction's rows and the correction, an overlay and its leave request or breach, a payroll input and its breach, a payslip revision and the payslip it replaces, a shift override and the request that created it (§8.1) | Tenant keys stop one organization's rows meeting another's, but nothing stopped one employee's punch being assigned to a colleague's day. That bug would surface only as a wrong payslip; with the person in the key, the database refuses it |
| D35 | **Settings that decide a day are dated rows, owned by the module that reads them.** The day-start time, the default closing extension, the rest warning and the night-consent rule are `shift_setting` rows; the arrival policy (with department overrides and one-day exceptions), the client-time tolerance and the night window are `attendance_setting` rows. A day is judged by the rows in force on its date, and a row dated in the past needs `attendance:correct` as well, as SH-6 does (§6.1, §8.1) | A setting kept as one current value would let today's change rewrite last year's days at the next recalculation. Ownership follows the dependency direction: a night window kept in payroll's configuration would make attendance read payroll, and a day-start time kept by attendance would make shifts read attendance |
| D36 | **What a correction adds is eligible wherever it falls.** The eligibility window keeps stray punches out of the arithmetic; a correction is a person, with a second person approving, saying a punch was real, so its `in`, `out` and break events count even outside the window — and approval refuses one the day would not read (§8.2, §12.1) | Without it, "a correction can include one when it was genuine" had no mechanism: a reviewer could confirm a real 05:30 start and still see it ignored |
| D37 | **A device punch is read once, when it first arrives, and the reading is stored with it.** Its corrected instant, the direction of the reader that produced it, what it means before any alternation — `in`, `out`, a trusted key or a plain scan — and whether the device was in dry-run are fixed from the device's settings at that moment, before anything can hold, refuse or park the punch, and never looked up again: not when a `held` or `unmapped` punch is replayed, not when the device resends its log, not when an alternating reader's sequence is worked out. A settings change reaches only the punches that arrive after it (§10.3 step 3, §10.4) | A punch can wait days before it is applied. Read at apply, a scan that arrived while the door was `undirected` and was replayed after the reader became `exit` would come back as a confirmed departure, and a punch from the dry-run weeks would write attendance once dry-run was off — history rewritten by a settings change, which D29 already forbids for applied events. The clock has been read this way from the start (L12). Device settings need no dated rows (D35), because the reading stored with each punch is what keeps its past fixed; the one case it leaves open is a punch made before a change but first delivered after it, which is read the new way, as it would be under a new clock offset (§10.6) |
| D38 | **Re-timing a device event never changes whose it is.** A clock correction looks the PIN up again at each punch's new instant, exactly as step 6 would, when the batch is built and again at approval. The same person: the event is re-timed. Anyone else, nobody, or a person outside their employment: it is not re-timed, and a reviewer gets a `retime-changes-subject` item. A punch moves between people only by two corrections — a void on one person's day and an add on the other's, the raw punch named in both — approved together under both people's locks (§10.6, §12.1) | A re-timed row must belong to the person of the row it replaces (D34), so without the check a clock fix that carried a punch back across a midnight where the PIN changed hands would leave Alice's punch on Bob's day, quietly and for good. Moving it automatically would be just as quiet the other way: which of two people a punch belongs to is a person's decision |

---

## 4. Architecture — who owns what, and how they talk

Each PRD module is a folder under `packages/server/src/modules/`, laid out like
the existing ones, with one addition: **`facade.ts` is the only file another
module may import** (the CI fix in §5.6 enforces it).

```
modules/attendance/
  facade.ts        the public surface other modules call (MB-1, MB-5)
  routes.ts        route() bindings, nothing else
  policy.ts        ResourcePolicy for attendanceRecord and attendanceCorrection
  service.ts       use cases; opens transactions through db.transaction
  repository.ts    SQL only
  calculate.ts     the pure calculator — imports nothing from platform/dal
  jobs.ts          recalculation, day-open and auto-close handlers
  validators.ts    zod schemas
  errors.ts
```

```
                        ┌──────────────┐
                        │    shifts    │  resolve · dayWindow   (geometry only)
                        └──────┬───────┘
              ┌────────────────┼──────────────────────┐
              ▼                ▼                      ▼
       ┌────────────┐   ┌──────────────┐       ┌────────────┐
       │  holidays  │──►│  attendance  │◄──────│ biometric  │  appendEvent
       │ (calendar) │   │ events,      │       │ devices,   │
       └────────────┘   │ records,     │       │ ingest     │
                        │ corrections  │       └────────────┘
    projector port ┌────┤              ├────┐
    (same tx)      ▼    └──────┬───────┘    ▲ applyOverlay
            ┌─────────────┐    │     ┌──────┴─────┐   ┌──────────────────┐
            │ live-status │────┘     │   leave    │   │ break-management │
            │ user_status │ append-  │ requests,  │   │ policies,        │
            │ punch route │ Event    │ WFH        │   │ breaches         │
            └─────────────┘          └────────────┘   └──────────────────┘
                               │ snapshotPeriod
                               ▼
                        ┌──────────────┐  LedgerFacade.post
                        │   payroll    │──────────────────► accounting (P6)
                        └──────────────┘
```

**Façades** — synchronous, and they take the caller's transaction (MB-2, TX-5):

| Façade | Owner | Called by | Does |
|---|---|---|---|
| `ShiftsFacade.resolve(tx, userId, date)` | shifts | attendance, live-status, break-management, holidays, payroll | The one resolution chain (SH-1) |
| `ShiftsFacade.dayWindow(tx, userId, date)`, `dayWindowContaining(tx, userId, instant)` | shifts | attendance, live-status | The geometric day partition, and nothing else (SH-I1, §5.2) |
| `AttendanceFacade.attributeEvent(tx, {userId, kind, occurredAt})` | attendance | `attendance` itself — `appendEvent`, correction approval and the neighbourhood pass; exposed so the day detail can explain an assignment | Which work date an event belongs to, and why (§5.2). It needs the event kind and the person's own events, so it cannot live in `shifts` |
| `AttendanceFacade.currentDayFor(tx, userId, at)` | attendance | live-status (board, rollover, `/today`), `appendEvent` itself | The day a person is *in* at that instant: geometry, extended while their previous session is open, unless the next day already has an arrival (§5.2) |
| `CalendarFacade.dayType(tx, userId, date, shift)` | holidays | attendance, leave | Holiday, week-off or working day (HO-1, HO-2) |
| `CalendarFacade.leaveDays(tx, userId, from, to)` | holidays | leave | Days that consume balance (LV-3) |
| `AttendanceFacade.appendEvent(tx, event)` | attendance | live-status, biometric | Attribute, then — for an interactive punch — check WFH, arrival policy, geofence and the state move against the **resolved** day; append (retiring any duplicate a device punch displaced), re-attribute the neighbourhood, re-derive the closure of every day that changed, bump input versions, run the projector port, queue recalculation. All of it under one per-person lock (§8.4) |
| `AttendanceFacade.retireEvent(tx, eventId, reason)` | attendance | biometric | Retire one effective event with a system void row when nothing new is appended — a duplicate displaced by a punch that bridges two bursts — under the same lock and with the same neighbourhood steps as an append; when a person's correction already superseded it, write nothing and open a review item (§8.4, §10.3 step 7) |
| `AttendanceFacade.applyOverlay(tx, …)` / `removeOverlays(tx, sourceId)` | attendance | leave, break-management | Leave and WFH days (LV-5), confirmed breach consequences (BM-5) |
| `AttendanceFacade.requestRecalculation(tx, userId, dates)` | attendance | shifts (SH-6), holidays (HO-3) | Range recalculation |
| `AttendanceFacade.snapshotPeriod(tx, userIds, from, to)` | attendance | payroll | Frozen inputs with record versions (PY-1) |
| `AttendanceFacade.openItems(tx, userIds, from, to)` | attendance | payroll | Pending corrections, flagged days, open days (PY-7) |
| `BreakFacade.unresolvedBreaches(tx, userIds, from, to)` | break-management | payroll | PY-7 |
| `GeofenceFacade.evaluatePunch(tx, …)` | identity | attendance | Geofence at punch time, inside `appendEvent` against the resolved day (§8.4 step 7); skipped on a WFH day (WFH-2) |
| `LedgerFacade.post(tx, entry)` | accounting (stub until P6) | payroll | PY-11, D16 |

**Port.** `PresenceProjector` is an interface in `contracts`. `live-status`
implements it and registers it at boot; `attendance` calls it inside
`appendEvent`. This is how every event — web, device, correction, auto-close —
updates the live board in the same transaction (LS-1, TECH §18) while
`attendance` never imports `live-status`.

**Outbox events** — written in the business transaction, published after
commit (TX-2, MB-3):

| Event | From | Consumed by |
|---|---|---|
| `attendance.recalc-requested` | attendance | recalculation queue |
| `status:changed` | live-status | Socket.IO rooms (RT-5) |
| `attendance.day-changed` | attendance | payroll (flags a published payslip, AT-9); performance later |
| `leave.decided`, `shift-request.decided`, `correction.decided` | leave, shifts, attendance | notifications (email until P7) |
| `biometric.device-alert` | biometric | device administrators (BI-7) |
| `payroll.published` | payroll | PDF rendering, employee notification |

Flagging a published payslip is a reaction, not part of the correction's
invariant, so it is an event (MB-3), not a façade. That also keeps `attendance`
from depending on `payroll`.

---

## 5. Step 0 — Groundwork

Small platform pieces every later step needs. None of them is People-specific.

### 5.1 Time rules

| # | Rule |
|---|---|
| T-1 | Instants are `timestamptz`, UTC on the wire (TECH §8.1). A day is a `date` in the organization's timezone (`organization.timezone`, NF-15). |
| T-2 | Day windows come only from the shifts façade, and an event's work date only from `AttendanceFacade.attributeEvent` (§5.2). People modules never use `CURRENT_DATE`, `now()::date`, `toISOString().slice(0, 10)` or `toISOString().split('T')`. A CI rule greps for them in the People module folders. |
| T-3 | Shift times are local wall-clock `time` values; they become instants per date with that date's zone rules, so a DST change cannot shift a boundary. |
| T-4 | One library, wrapped once in `platform/time.ts`: Luxon (already in the lockfile, IANA-aware). No other file imports it, so moving to native `Temporal` later is a one-file change. |
| T-5 | A `clock` port is injected into services and jobs so tests can freeze time. The calculator never reads a clock (AT-I1). |
| T-6 | Event instants are whole seconds. Every writer truncates through `platform/time.ts`, and a `CHECK` on `attendance_event` refuses anything finer. A terminal reports seconds, so a second is the finest distinction the evidence supports; two events in one second are placed by kind (§5.3, D32), never by which row was written first. |

### 5.2 Which day a punch belongs to

The TECH §9.4 sketch decides the day from the punch's local time and the
shift's end time. It is wrong in two ordinary cases:

| Case | Sketch says | Should be |
|---|---|---|
| Night shift 22:00–07:00, punch-out at 07:20 | next day (07:20 is not before 07:00) | the night that started the shift |
| Day shift 09:00–18:00, punch-out at 00:40 after a late release | next day | the day that started the shift |

**Rule.** Between two consecutive days, the boundary is the **midpoint of the
off-duty gap** — halfway between the end of one day's shift and the start of
the next day's shift. Both days compute the same boundary from the same two
shifts, so every instant belongs to exactly one day.

```
            Mon 09:00 ────── Mon 18:00          Tue 09:00 ────── Tue 18:00
                shift              │   gap 15 h    │
                                   └──── 01:30 ────┘   ← Mon/Tue boundary

  22:00 ── 07:00 (night)   gap 15 h   22:00 ── 07:00
                  └────── 14:30 ──────┘                ← day boundary
```

- **Three different questions, three different answers.** An earlier revision
  used one window for all of them and produced a contradiction: it attributed a
  07:30 punch-out to the night that was still open, while the calculator threw
  the same event away for falling outside that night's window. They are not the
  same question:

  | Question | Answer | Owner |
  |---|---|---|
  | Which day is this person *in* right now? | `currentDayFor` — the geometric partition below, extended while a session is open, released once the next day has an arrival | `attendance` (over `shifts`' `dayWindow`) |
  | Which day does *this event* belong to? | `attributeEvent` — the midpoint, overridden by the three ordered rules below | `attendance` |
  | May an attributed event count as working time? | the day's **eligibility window**, which is *not* clipped to the day window (§8.2) | `attendance` |

  The day window partitions time and never selects events; attribution decides
  ownership and may cross a boundary; eligibility decides whether an owned
  event is arithmetic or only evidence. Neighbouring eligibility windows may
  overlap, and that is fine, because an event has exactly one owner.

- **The midpoint alone cuts real sessions, so attribution checks three
  session-aware rules first, in a fixed order.** A Sunday night of 20:00–05:00
  followed by a Monday morning of 09:00–18:00 puts the boundary at 07:00. A
  genuine punch-out at 07:30 — two and a half hours of overtime on the night —
  would land on Monday, and a Monday employee arriving at 06:30 for a 09:00
  start would land on Sunday. Both are wrong, and neither is rare in a rotating
  roster.

  ```
  closingCap(D) = min(D's shift end + max closing extension, D+1's shift start)
                                                   ← ONE number, used in three places
  openFrom(D)   = max(D's shift start − early window, D−1's shift end)
  arrival       = an `in` from any channel, or a `scan`
  arrivalOf, departureOf
                = a day's ONE arrival — its first eligible arrival — and ONE
                  departure — its first eligible `out` or `auto-out` after
                  that, both from readDay (§5.3, D31)
  the order     = by instant (whole seconds), and within one second by kind:
                  out, in, scan, break-start, break-end, auto-out. One kind in
                  one second is one piece of evidence and is attributed once.
                  Never by id, never by delivery order (§5.3, D32)

  D has ARRIVED before e  ⇔  arrivalOf(D's effective events that come
                             before e in the order) exists
  D is OPEN at e          ⇔  D has arrived before e, departureOf(the same
                             events) does not exist, and e's instant ≤
                             closingCap(D)
  A system `auto-out` never counts here. Auto-close writes it at closingCap, so
  on time it cannot exist yet — and a late punch must land where it would have
  landed on time (§12.4).

  For an event e at instant t, with G the day whose window holds t — FIRST MATCH WINS:

  1. G+1 claims it   G+1 has already arrived before e
                        → reason next-shift-started
                     or e is an arrival at or after openFrom(G+1)
                        → opening-pull-forward when G is not open at e;
                          next-shift-started when it is, and G is flagged
                          previous-session-unconfirmed
  2. G claims it     G has already arrived before e
                        → midpoint
                     or e is an arrival at or after openFrom(G)
                        → midpoint when G−1 is not open at e;
                          next-shift-started when it is, and G−1 is flagged
                          previous-session-unconfirmed
  3. G−1 claims it   G−1 is open at e: the closing extension, for every kind
                        → closing-extension; an `in` here is also flagged
                          overlapping-arrival
  4. otherwise       → G, midpoint
  ```

  With a 4-hour maximum closing extension and a 3-hour early window, a night of
  20:00–05:00 before a 09:00 morning has `closingCap = 09:00` and
  `openFrom(Monday) = 06:00`, and every case comes out right:

  | Event | Belongs to | Rule |
  |---|---|---|
  | `05:20 out` | Sunday | 2 — still Sunday's window, and Sunday has started |
  | `07:30 out`, night still open | Sunday | 3 — open, and 07:30 ≤ 09:00 |
  | `07:30:00 out` and `07:30:00 in` in one second, night still open | the `out` Sunday, the `in` Monday | 3, then 2 — the `out` is read first and closes the night, so the `in` finds nothing open |
  | `07:10 break-start`, `07:20 break-end`, then `07:30 out` | Sunday | 3 — the extension takes every kind |
  | `09:05 out` | Monday, as conflicting evidence for review | 4 — past the cap |
  | `06:30 in`, night closed at 05:02 | Monday | 1 — an arrival after 06:00, `opening-pull-forward` |
  | `06:45 break-start` after that `06:30 in` | Monday | 1 — Monday has started, though 06:45 is Sunday's window |
  | `07:30 out`, night closed at 05:02 | Monday | 4 — nothing is open to extend |
  | `08:50 in` on the web, night never closed | Monday; Sunday flagged `previous-session-unconfirmed` | 2 — an arrival after 06:00 |
  | `08:55 break-start` after that | Monday | 2 — Monday has started |
  | `07:30 out` delivered at 09:10, after auto-close wrote a 05:00 `auto-out` | Sunday | 3 — the `auto-out` does not count; the closure is then re-derived (§12.4) |

  On a night-after-night roster the same rules keep real overtime: the next
  shift's opening window starts at 17:00, so a 07:30 scan is the night's by
  rule 3, and a 13:10 errand scan falls to Monday by the midpoint, outside its
  eligibility window (§8.2). **The answer never depends on when a punch was
  delivered.**

  **The extension follows the session, not the event kind.** Someone working
  two hours past a night shift takes a break at 07:10 and ends it at 07:20
  before punching out at 07:30. If only `out` were extended, those two break
  events would land on Monday as orphans and Sunday would show overtime with no
  break in it. While a session is open, everything up to `closingCap` belongs
  to it — until the next shift starts.

  **The next shift wins once it starts (rules 1 and 2, D30).** A session left open
  into the morning happens two ways: on a single-reader site an undirected scan
  never closes a session (§9.1), and on any site a person can simply forget to
  punch out. Take the rotation above. Without rules 1 and 2, the person's 08:50
  arrival for the morning — a scan, an entry-reader `in` or a web punch-in —
  would be handed to the still-open night: auto-close would book it as the
  night's departure, the night would read twelve hours fifty, and Monday would
  lose its arrival. On the web it would be worse: the `in` would be checked
  against Sunday, which is `WORKING`, refused with 422, and the only button left
  would be "Punch out" — a confirmed departure at 08:50 that invents 3 h 50 m of
  overtime. So an arrival inside the next shift's opening window starts the next
  day whether or not the previous session was ever closed. The **previous** day
  takes the flag `previous-session-unconfirmed`, because the problem is the
  night's unknown departure, not the morning's arrival: auto-close takes that
  departure from the night's own evidence — the 05:04 scan on a one-reader
  site, the shift end otherwise — and opens a review item, and the employee can
  ask for a correction with the real time. Once the next day owns an arrival,
  rule 1 or 2 keeps every later event on it, so a break at 08:55 is Monday's.
  Departures are unaffected: an `out` at 07:30 — web, exit reader or trusted
  key — still closes the night by rule 3, because nothing about it looks like
  the next shift starting. Where the next shift is a day away, its opening
  window is far off, and the night keeps its overtime.

  **`closingCap` is one number with three jobs**: it bounds the closing
  extension here, it is the late edge of the day's eligibility window (§8.2),
  and it is when auto-close runs (§12.3). They were separate settings in an
  earlier revision, which is how auto-close ended up able to close a night at
  07:00 that attribution would still accept a punch-out into at 07:30. The
  maximum closing extension is an organization setting (`shift_setting`, dated;
  Q3 — TapCRM uses four hours), overridable per shift version.
- **The rules stay deterministic.** Openness is read from the events themselves
  — an arrival with no `out` before that event in the order, within the cap —
  never from live state, so replaying a month a year later gives the same answer
  (AT-I1). System `auto-out` rows are left out on purpose: auto-close derives
  them from the day's real events (§12.3), so letting them steer attribution
  would make the result depend on when auto-close happened to run relative to a
  delayed punch (D25). **The order matters, and it is part of the rule**: a
  06:30 arrival for a 09:00 shift satisfies rule 1 (the morning's window has
  opened) and rule 2 (Sunday has started), and an 08:50 arrival while the night
  is still open satisfies rule 2 and rule 3. Checking the next shift first is
  what keeps the morning's arrival off the night in both. Every rule is bounded
  — by `closingCap` or by `openFrom` — so none can reach past the neighbouring
  shift. **Ties are part of the rule too**: two events in one second are read in
  the order above, so an `out` and an `in` both stamped 07:30:00 always mean the
  night ended and the morning began — never whichever row happened to be written
  first.
- **Because attribution depends on the event kind and on the person's own
  events, it belongs to `attendance`, not to `shifts`.** `shifts` answers
  "where are the boundaries", which needs only shift data;
  `AttendanceFacade.attributeEvent` answers "which day owns this event", which
  needs the kind and the session. Putting the second one in `shifts` would make
  `shifts` read attendance events — a circular dependency, and the reason the
  earlier `workDateFor(userId, instant)` signature could not have worked
  anyway: it cannot tell a 07:30 `out` from a 07:30 `in`.
- **The answer is stored, not recomputed from a timestamp.** Every event gets a
  row in `attendance_event_assignment` naming the day that owns it and why
  (§8.1). The raw event stays immutable; the assignment is derived, so it can
  be rebuilt — which matters because a later change can legitimately move an
  event to the other day (§8.4).
- **Which day a person is *in* also stretches while they are still clocked
  in** — but only until the next day genuinely starts.
  `AttendanceFacade.currentDayFor(userId, at)` answers it in five steps:

  ```
  1. G = dayWindowContaining(at)
  2. if G+1 has ARRIVED by `at`                          → G+1
       (only reachable through attribution's rule 1 — nothing else puts an
        event on a day whose window has not started)
  3. else if G has ARRIVED by `at`                       → G
  4. else if G−1 is OPEN at `at` (the definition above, capped at closingCap) → G−1
  5. else → G
  ```

  "By `at`" counts every event up to and including that second, because the
  question is where the person stands once it has passed; "open at `at`" is
  the same test over the same events.

  The night cases fall out of it:

  | Moment | G | Answer | Why |
  |---|---|---|---|
  | 06:30 `in`, pulled forward to a 09:00 morning | Sunday (boundary 07:00) | **Monday** | step 2 — Monday already owns the arrival |
  | 07:30, the night still open, about to punch out | Monday | **Sunday** | steps 2–3 find no arrival; step 4, the session is open and 07:30 ≤ 09:00 — so the punch-out is checked against the night |
  | 07:30, once that `out` is recorded | Monday | **Monday** | nothing is open any more, so step 5 — and the board is rebuilt as Monday's in the same transaction (§8.4 step 11) |
  | 08:50 arrival for the morning — a scan, or a web `in` after a night never closed | Monday | **Monday** | step 3 — Monday owns the arrival |

  Step 2 exists because attribution's rule 1 can assign an arrival to a day
  *before its window opens*; without it the 06:30 case would keep answering
  "Sunday" right up to 07:00, even though the person has already started
  Monday. Step 3 is what keeps rule 2 honest: the night's session can stay
  technically open into the morning — one reader, or a forgotten punch-out —
  so without it a person who arrives at 08:50 would still count as "in
  Sunday", and the board would not show them working until auto-close ran.
  Steps 2–4 are the same questions attribution asks, in the same order, which
  is why the board and the ledger cannot disagree about where a person is.
  **An attendance day staying open is not the same thing as the person's
  current live day**: Sunday remains open, awaiting its auto-close and its
  review item, while Monday is where the person now is.
- **A day with no fixed times still gets an anchor.** Falling back to midnight
  would undo the fix whenever the next day is flexible: a Monday 09:00–18:00
  finish at 00:40 would land on a flexible Tuesday again. So a missing start or
  end is filled, in order, from (1) the person's **assigned** shift template
  version in force on that date — the one from `shift_assignment`, even when a
  higher-precedence rule made the day flexible — (2) their department's default
  shift, (3) the organization's day-start time (`shift_setting`, 00:00 by
  default).
  The anchor used is recorded in the day's provenance, so "why did this punch
  land here" is always answerable.
- **The anchor deliberately never searches nearby days.** An earlier draft
  looked for the nearest fixed shift within a week, which made Friday's shift a
  silent input to Monday's boundary while a shift change only recalculates the
  day and its neighbours — a dependency nothing would recalculate. Every anchor
  source above is an assignment, a department default or a setting, and each of
  those already recalculates its own affected range when it changes (SH-6). A
  new day-start time is a new dated `shift_setting` row, so it applies from its
  own date and recalculates the days from there; a row dated in the past needs
  `attendance:correct` as well, as SH-6 requires of any past shift change.
- **Overlapping windows are refused, not truncated.** If a person's two
  consecutive shifts would overlap — say a 14:00–23:00 day followed by a
  20:00–05:00 night — the assignment, override or approved request is refused
  with 422 `SHIFT_WINDOW_OVERLAP`, naming both shifts and the overlap. Silently
  moving the boundary to the earlier shift's end would put part of the later
  shift on the previous day, and nobody would ever see why the hours landed
  where they did. Consider a Sunday night of 20:00–05:00 and a Monday morning
  of 04:30–13:30: a 04:30 arrival could be read as the tail of Sunday's night.
  Refusing the pairing is the only answer that stays true later. Two shifts
  that merely *touch* are fine — the gap is zero and the boundary is that
  instant.
- **The resolver guards it again at read time.** Validation stops it being
  entered, but imported history, a department default changed under an existing
  assignment, or a migration can still produce two overlapping windows. When
  the resolver meets that, the day is flagged `shift-window-overlap`, left
  `not-evaluated`, and sent to the review queue — never silently truncated, and
  payroll will not run for that person until it is fixed (§14.4).
- A week-off still has a resolved shift (week-offs are a calendar fact, §7), so
  a Friday late finish after midnight stays on Friday.
- Each `attendance_record` stores its window (`window_start`, `window_end`),
  which is what materialisation, the live board and display use. It is **not**
  how a day's events are found: those come from their assignments (§8.1). When
  a shift changes, the day and both neighbours are re-attributed and
  recalculated, so no event can end up on two days or on none.
- This is still one function (SH-I1). Its test suite adds to SH-I2: punch-out 20
  minutes after a night shift ends, a day-shift punch-out after midnight, a
  punch exactly on the boundary, a fixed day followed by a flexible day (the
  anchor case), a fixed day followed by a day with no shift at all, touching
  shifts, and two different shifts on consecutive days. Every row of the table
  above is a case, and the order has tests of its own: the 06:30 arrival that
  satisfies rules 1 and 2, and the 08:50 arrival that satisfies rules 2 and 3,
  both go to the new day. So do the same-second cases: an `out` and an `in`
  stamped 07:30:00 split between the night and the morning whichever is
  delivered first, and two `in`s in one second are attributed together. SH-I2's
  "start and end clock times are equal" case is answered by refusing such a
  shift (§6.1), so its test asserts the refusal and that no attendance path can
  ever see one.

Overnight shifts are a **first-class case**, not an edge one. An organization
using this product will run a 09:00–18:00 shift and a 20:00–05:00 shift side by
side, and both are created, assigned, judged and paid through the same screens
and the same code. §6.6 walks one night shift through every module.

### 5.3 Shared types

`packages/contracts/src/people.ts` holds types only. The calculators import
these and nothing else.

```ts
export type DateOnly = string & { readonly __brand: 'DateOnly' };   // 'YYYY-MM-DD', org timezone
export type LocalTime = string & { readonly __brand: 'LocalTime' }; // 'HH:mm'
export type HalfDays = 0 | 1 | 2;

/** The SH resolution chain, highest precedence first. */
export type ShiftSource =
  | 'date-override' | 'permanent-flexible' | 'flexible-request'
  | 'rotation' | 'template' | 'department-default' | 'none';

export interface ResolvedShift {
  source: ShiftSource;
  shiftId: string | null;
  versionId: string | null;
  kind: 'fixed' | 'flexible' | 'none';
  start: LocalTime | null;            // fixed only
  end: LocalTime | null;
  isOvernight: boolean;               // end is on the next calendar day
  graceMinutes: number;               // AT-4
  earlyExitGraceMinutes: number;
  fullDayMinutes: number | null;      // fixed: shift version; flexible: 480 (SH-4)
  halfDayMinutes: number | null;      // fixed: shift version; flexible: 300 (SH-4)
  minOvertimeMinutes: number | null;  // AT-5
  earlyWindowMinutes: number;         // how early an arrival may come (§5.2), from the version
  maxClosingExtensionMinutes: number; // the version's own, else shift_setting's (§5.2, Q3)
  timezone: string;                   // IANA, from the organization
}

export type EventKind = 'in' | 'out' | 'break-start' | 'break-end' | 'scan' | 'auto-out';
export type EventSource = 'device' | 'web' | 'mobile' | 'correction' | 'system' | 'import';

export type Evidence = 'confirmed' | 'assumed';   // stamped when recorded, never re-derived (D29)

/** Effective events only: superseded rows and void (tombstone) rows never reach
 *  the calculator, attribution or presence replay (§8.1, D28). */
export interface AttendanceEventInput {
  id: string;
  kind: EventKind;
  at: string;                         // ISO instant, whole seconds (T-6), already clock-corrected
  source: EventSource;
  evidence: Evidence;
  assignmentReason: AssignmentReason; // why this day owns it (§8.1)
}

export type AssignmentReason =
  | 'midpoint' | 'closing-extension' | 'opening-pull-forward'
  | 'next-shift-started'               // the next shift had started, or started with this event (§5.2)
  | 'system-close' | 'reconciliation'  // the system's own rows: a closing auto-out, and the void rows that
                                       // retire an auto-out or a displaced duplicate (§12.3, §12.4, §10.3)
  | 'correction' | 'import';

/** Pinned assignments are never moved by automatic re-attribution (§8.1). */
export const PINNED_REASONS = ['correction', 'system-close', 'reconciliation'] as const;
```

**The presence state machine lives here too, in
`packages/contracts/src/presence.ts`** (D26) — pure data and pure functions, no
table, no tenancy, no I/O:

```ts
export type PresenceState = 'NOT_IN' | 'WORKING' | 'ON_BREAK' | 'FINISHED';

/** A day's eligibility window (§8.2); null for flexible and no-shift days,
 *  where everything assigned to the day is eligible. What a correction adds is
 *  eligible wherever it falls (D36). */
export type EligibilityWindow = { from: string; to: string } | null;

export const PRESENCE: Readonly<Record<PresenceState, Partial<Record<EventKind, PresenceState>>>>;

export function nextState(from: PresenceState, kind: EventKind): PresenceState | null;
export function allowedMoves(from: PresenceState): EventKind[];

/** The order of a day's events (D32): by instant, then by this list. An `out` comes
 *  first, so it ends what is open before anything new starts in that second, and can
 *  never be the departure of an arrival in the same second. A system `auto-out` is last. */
export const KIND_ORDER = ['out', 'in', 'scan', 'break-start', 'break-end', 'auto-out'] as const;

/** Negative, zero or positive. Zero means one piece of evidence: same second, same kind.
 *  Never looks at ids, sources or when a row was written. */
export function compareEvents(a: AttendanceEventInput, b: AttendanceEventInput): number;

export interface DayStep { at: string; kind: EventKind; evidence: Evidence; eventIds: string[] }

export type NotApplied =
  | 'outside-window'       // not eligible for this day (§8.2)
  | 'before-arrival'       // an `out` with nothing open
  | 'at-arrival-instant'   // an `out` in the arrival's own second: conflicting evidence
  | 'after-departure'      // a later second than the departure
  | 'no-move';             // no move from the state it met, e.g. a second `in`

export interface DayReading {
  state: PresenceState;
  arrival: DayStep | null;                           // the ONE arrival (D31)
  departure: DayStep | null;                         // the ONE departure (D31)
  breaks: { from: string; to: string | null }[];     // the ON_BREAK stretches
  notApplied: ReadonlyMap<string, NotApplied>;       // every other event, and why
}

/** THE reading of a day: its eligible effective events, grouped by second and kind,
 *  walked through PRESENCE in the order above. A group's evidence is confirmed if any
 *  member's is. Nothing else puts a day's events in order. */
export function readDay(events: readonly AttendanceEventInput[], window: EligibilityWindow): DayReading;

export const arrivalOf   = (e: readonly AttendanceEventInput[], w: EligibilityWindow) => readDay(e, w).arrival;
export const departureOf = (e: readonly AttendanceEventInput[], w: EligibilityWindow) => readDay(e, w).departure;
export const replay      = (e: readonly AttendanceEventInput[], w: EligibilityWindow) => readDay(e, w).state;
```

**Why it is here and not in `live-status`.** Two modules now need the same
answer. `attendance` validates an interactive move against the resolved day
(§8.4 step 7); `live-status` steps the board forward in `apply` and rebuilds it
in `refresh` (§9.3). `attendance` may not import `live-status` (TECH §3.1), so
the alternatives were to duplicate the table, break the boundary, or create a
cycle — and a duplicated state machine is two state machines that drift. It
belongs in `contracts` for the same reason `ResolvedShift` does: modules import
`contracts`, `authz` and `platform` and nothing else, and this is a pure
domain rule with no owner.

**Not a port.** A port exists for behaviour that needs another module's state
or I/O — `PresenceProjector` writes a row, so it is one. A transition table
needs neither, so injecting it would add a registration step and a boot-order
failure mode and buy nothing. It is imported, like any other shared type.

**One reading of a day** (D31, D32). A day has exactly one arrival and one
departure: its first eligible `in` or `scan`, and its first eligible `out` or
`auto-out` after that. They come from one walk, `readDay`, not from helpers
that each read the events their own way: revision 17 had two, and an `in` and
an `out` both stamped 09:00:00 gave its calculator no departure (it wanted a
strictly later `out`) while its replay, sorting by time alone, finished the day
at 09:00. `arrivalOf`, `departureOf` and `replay` are views of the walk, and
attribution's openness test, `closeDecision`, the calculator and the projector
all read a day through it. Anything after the departure is evidence, not time:
a second exit swipe at 05:10 after a 05:00 punch-out is kept and flagged
`activity-after-finish`, and worked minutes stop at 05:00. If 05:10 really was
the departure, a reviewer replaces the 05:00 punch (`replace-event`, §12.1), and
the supersession chain makes 05:10 the only effective departure. The window
matters as much as the order: a punch outside the day's eligibility window is
never its arrival or its departure.

**Events in the same second** (D32). Instants are whole seconds (T-6), so a
door scan and a web punch, two readers, or an HR correction entered as 09:00
can share one. The order decides what they mean, identically everywhere:

| In one second | Reading | Why |
|---|---|---|
| `in` and `out`, nothing open | Arrival at that second, no departure; the `out` is kept and flagged `same-instant-conflict`, and a review item asks which is right | The `out` is read first, while nothing is open, so it cannot be the departure of an arrival it does not follow |
| `scan` and `out`, nothing open | The same | A scan is an arrival here |
| `in` and `out` at 06:30 after a night that closed at 05:02, the `in` pulled forward to the morning | The morning arrives at 06:30; the `out`, read first, finds nothing to end and stays with the finished night, flagged `activity-after-finish` for review | The ordinary rules place it (§5.2 rule 2); it is reviewed where it landed, and it is still nobody's departure |
| `out` and `in`, a night still open | The night ends, then the morning starts (§5.2) | A handover, read in the only order that makes sense |
| `in` and `break-start` | Arrived, and on break from that second | Arrivals come before breaks |
| `break-start` and `break-end` | A zero-length break | Start before end; the reverse would leave the break open |
| the last event and an `auto-out` | The `auto-out` is the departure, even in the arrival's own second | The system's row is read last |
| two of one kind — a web `in` and an entry-reader `in` | One arrival, attributed once, `confirmed` if either is | Otherwise the copy could be attributed apart from the original |

No rule looks at an event's id, its source or when its row was written. Ids are
generated in whatever order rows happen to be inserted, so breaking a tie on one
would make a day depend on delivery order — the one thing §5.2 promises it
never does.

What stays in `live-status`: the `user_status` table, the projector, the
confidence and `likely_finished_at` semantics, the board's groups and counts,
`rollover_due_at` and its sweeper, and the socket events. Those are projection
concerns. The **rule** — which moves are legal — is shared, declared once
(§9.1), and a CI check fails the build if either module declares a transition
of its own.

The calculator receives the events **already assigned** to the day it is
computing, so it never asks "which timestamps fall between these bounds" —
that question has one answer, computed once, and stored (§5.2, §8.1).

### 5.4 Job runner

`platform/jobs.ts` today runs one queue whose worker switches on the job name,
for four daily maintenance jobs. It becomes a small general runner that every
job in this design uses, and those four move onto it unchanged:

- `defineJob({ name, schedule?, perOrganization, handler })` registers a BullMQ
  worker and, for scheduled jobs, one `upsertJobScheduler` entry — scheduled
  once per deployment, not once per process (TapCRM L25).
- Every run writes `job_run` with outcome, items and errors (JB-2), under an
  idempotency key (JB-1).
- Per-organization jobs build a `createJobContext` per organization (JB-3).
- Retries back off, then dead-letter with an alert (JB-4). Nothing retries
  forever.
- **Dead-lettered work comes back by generation, not forever.** A key that has
  used up its retries dead-letters, and the queue will not accept that key
  again. A sweeper that later finds the same work still undone may enqueue it
  under the key's next generation (`…:g2`, `…:g3`) — no sooner than a day after
  the last failure, at most three generations, counted in `job_run` — after
  which the item is flagged for a person. Work whose inputs changed has a new
  key and starts again at generation one. That is how "never retry every hour"
  (L5) and "never forget an open day" (L6, D21) hold at the same time.

### 5.5 Domain outbox drainer and realtime

- A drainer for `domain_outbox`, modelled on the audit drainer: it claims
  pending rows, publishes them (BullMQ queue or Socket.IO) and marks them
  processed. It wakes on `NOTIFY` after commit and polls every second as a
  fallback, which keeps a punch on the board inside the 3-second budget (NF-2).
- **Delivery is at least once, not exactly once** (D22). Publishing can succeed
  and the "processed" write can still fail, so the same event will arrive
  again. Every row therefore carries a stable `event_id`, and every consumer is
  either naturally idempotent — an upsert or an insert behind a unique key — or
  keeps a small inbox table of handled event ids. "The consumer sorts it out"
  is written into each consumer, not assumed.
- A Socket.IO server with the Redis adapter (both packages are already
  dependencies), checking the session version at handshake (RT-1). Rooms are
  per organization; each viewer only receives changes for people their
  `attendance:view-live` scope covers.

### 5.6 Fixes and migrations

1. Fix the boundary check to catch `../<other-module>/…` imports, and allow
   cross-module imports only of `facade.ts`. Move the six existing `employee`
   imports onto façades.
2. Add the T-2 grep rule.
3. Change the geofence WFH check to the organization-local date.
4. Migration: `CREATE EXTENSION IF NOT EXISTS btree_gist` (for the no-overlap
   constraints below) and the PRD §5.8 `module_dependency` rows.

**Done when** CI catches a sibling-module service import, a scheduled job
leaves a `job_run` row, and an outbox row reaches a connected socket in under a
second.

---

## 6. Step 1 — Shifts

**In plain words.** HR defines shift templates, gives people a template, a weekly
rotation, or permanent flexible hours, and can override one person on one date.
Employees can ask for a flexible day or a change. One function answers "which
shift applied to this person on this date, and why", and every other module
asks it.

### 6.1 Tables

```sql
CREATE TABLE shift (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  code            text NOT NULL,
  name            text NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('fixed', 'flexible')),
  status          text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'inactive')),   -- SH-5: deactivated, never deleted
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user (organization_id, id)
);

-- SH-2: editing a template writes a new version; nothing before its date changes.
CREATE TABLE shift_version (
  id                       uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id          uuid NOT NULL REFERENCES organization(id),
  shift_id                 uuid NOT NULL,
  effective_from           date NOT NULL,
  start_time               time,              -- fixed only
  end_time                 time,              -- fixed only; end < start means overnight
  grace_minutes            integer NOT NULL CHECK (grace_minutes BETWEEN 0 AND 240),
  early_exit_grace_minutes integer NOT NULL DEFAULT 0,
  full_day_minutes         integer NOT NULL,  -- D6: HR enters it; flexible is always 480 (SH-4)
  half_day_minutes         integer NOT NULL,  --     flexible is always 300 (SH-4)
  min_overtime_minutes     integer,           -- AT-5; NULL means overtime is not tracked
  created_by               uuid NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  early_window_minutes     integer NOT NULL DEFAULT 180,   -- how early a punch can still be the arrival (§8.2)
  max_closing_extension_minutes integer,           -- NULL = shift_setting's (§5.2, Q3)
  UNIQUE (organization_id, shift_id, effective_from),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, shift_id) REFERENCES shift (organization_id, id),
  complementary_half_minutes integer,               -- §8.3; NULL means half_day_minutes ÷ 2
  CHECK (half_day_minutes > 0 AND half_day_minutes < full_day_minutes),
  -- that full_day_minutes fits inside the scheduled span, and complementary_half_minutes
  -- inside half of it, is enforced on save: both need the start/end arithmetic (§6.3)
  -- A fixed shift must have two different clock times. 20:00 → 20:00 is a typo, not a
  -- 24-hour shift, and reading it as one would silently pay a whole day (§6.3).
  CHECK (start_time IS NULL OR end_time IS NULL OR start_time <> end_time)
);

CREATE TABLE shift_rotation     (id, organization_id, name, status, …);
CREATE TABLE shift_rotation_day (organization_id, rotation_id, weekday smallint CHECK (weekday BETWEEN 1 AND 7),
                                 shift_id uuid,               -- NULL: no shift that weekday
                                 PRIMARY KEY (organization_id, rotation_id, weekday));

-- Chain steps 2, 4 and 5. One active assignment per kind per person per date.
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
  CHECK ((kind = 'template') = (shift_id IS NOT NULL)),
  CHECK ((kind = 'rotation') = (rotation_id IS NOT NULL)),
  EXCLUDE USING gist (organization_id WITH =, user_id WITH =, kind WITH =,
                      daterange(effective_from, effective_to, '[)') WITH &&)
);

-- Chain step 1. Created by HR, or by an approved change request.
CREATE TABLE shift_override (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id   uuid NOT NULL REFERENCES organization(id),
  user_id           uuid NOT NULL,
  work_date         date NOT NULL,
  kind              text NOT NULL CHECK (kind IN ('shift', 'flexible', 'no-shift')),
  shift_id          uuid,
  reason            text NOT NULL,
  origin_request_id uuid,                       -- removed together with its request
  created_by        uuid NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id, work_date),
  CHECK ((kind = 'shift') = (shift_id IS NOT NULL))
);

CREATE TABLE department_shift_default (organization_id, department_id, shift_id, effective_from, effective_to,
                                       EXCLUDE USING gist (… department_id WITH =, daterange(…) WITH &&));

CREATE TABLE shift_request (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id    uuid NOT NULL REFERENCES organization(id),
  user_id            uuid NOT NULL,
  kind               text NOT NULL CHECK (kind IN ('flexible', 'change')),
  from_date          date NOT NULL,
  to_date            date NOT NULL,
  requested_shift_id uuid,                      -- change only
  reason             text NOT NULL,
  status             text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by       uuid NOT NULL,             -- the registry initiator field for shifts:approve
  decided_by         uuid,
  decided_at         timestamptz,
  decision_note      text,
  UNIQUE (organization_id, user_id, id),        -- the override made from it points here (D34)
  CHECK (to_date >= from_date AND to_date - from_date <= 31),
  CHECK (decided_by IS NULL OR decided_by <> requested_by)  -- A1 in the database, as role_change_request does
);
-- An override made by approving a request belongs to the request's person (D34).
ALTER TABLE shift_override
  ADD FOREIGN KEY (organization_id, user_id, origin_request_id)
      REFERENCES shift_request (organization_id, user_id, id);

-- Organization-wide shift settings, dated like a shift version (D35): a day's boundary
-- is always computed from the row in force on its date. shifts owns them because its
-- resolver and day windows read them, and shifts may not read attendance.
CREATE TABLE shift_setting (
  id                            uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id               uuid NOT NULL REFERENCES organization(id),
  effective_from                date NOT NULL,
  day_start_time                time NOT NULL DEFAULT '00:00',   -- the last boundary anchor (§5.2)
  -- Q3: HR's number, with no default; a shift version may override it.
  max_closing_extension_minutes integer NOT NULL
                                  CHECK (max_closing_extension_minutes BETWEEN 0 AND 720),
  minimum_rest_minutes          integer,                           -- NULL: no rest warning (§6.6)
  night_consent_mode            text NOT NULL DEFAULT 'refuse'     -- Q14: refuse, or only warn
                                  CHECK (night_consent_mode IN ('refuse', 'warn')),
  night_consent_from            time,                              -- Q14: NULL = no consent check
  night_consent_to              time,
  created_by                    uuid NOT NULL,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, effective_from),
  CHECK ((night_consent_from IS NULL) = (night_consent_to IS NULL))
);
```

Every table gets `apply_tenant_rls(...)`, composite tenant foreign keys and the
usual grants, exactly as `migrations/0023` does. Where both rows belong to a
person — an override and the request that created it, above — the key carries
`user_id` as well (D34).

### 6.2 The resolver (SH-1)

`resolveShift(inputs, date)` is pure; `ShiftsFacade.resolve` loads the inputs
and calls it. The chain, highest first:

| Step | Source | Result |
|---|---|---|
| 1 | `shift_override` for that person and date | that template's version on that date, flexible, or no shift |
| 2 | `permanent-flexible` assignment covering the date | flexible, 8 h / 5 h (SH-4) |
| 3 | approved `flexible` request covering the date | flexible for that date |
| 4 | `rotation` assignment → the weekday's template | that template's version on that date |
| 5 | `template` assignment | that template's version on that date |
| 6 | the department's default | that template's version on that date |
| 7 | nothing | `kind: 'none'` — recorded, not evaluated |

- "Version on that date" is the latest `shift_version` with
  `effective_from <= date`. That is how a template edit never reaches back
  (SH-2).
- An approved **change** request writes `shift_override` rows for its dates,
  with `origin_request_id`, so it lands at step 1. TapCRM left overrides behind
  after a request was rejected or deleted (L15); here they go with their
  request.
- Step 6 uses the person's current department; the directory keeps no
  department history yet.
- No other module reads the `shift*` tables. A CI grep rule enforces it, which
  is the practical meaning of SH-1.

### 6.3 Rules

| Rule | How |
|---|---|
| SH-2 | Versions plus the per-day snapshot stored on `attendance_record` |
| SH-3 | Day boundaries from §5.2; overnight suite |
| SH-4 | Flexible thresholds are constants in the calculator, not settings |
| SH-5 | No delete route exists; `PATCH` sets `inactive`; inactive templates cannot be newly assigned, and existing assignments keep resolving |
| SH-6 | A change effective before today (organization date) needs `attendance:correct` as well — checked with the engine's `holdsPolicy`, refused with 403 `SHIFT_PAST_CHANGE_NEEDS_CORRECTION_AUTHORITY`; on success the affected dates and their neighbours are recalculated |
| SH-7 | The engine blocks self-approval through `requestedBy`; the `CHECK` backs it up |
| Start ≠ end | A fixed shift with equal start and end times is refused (`SHIFT_START_END_MUST_DIFFER`); overnight is strictly `end < start`, and there is no 24-hour shift by accident |
| Thresholds fit | Saving refuses a `full_day_minutes` above the shift's scheduled minutes, and a `complementary_half_minutes` above half of them, so no threshold can be impossible to reach (§8.3) |
| No overlap | An assignment, override or approved request that would overlap the same person's neighbouring work window is refused with 422 `SHIFT_WINDOW_OVERLAP` naming both shifts; the resolver flags any overlap that reached the data another way and leaves the day unevaluated (§5.2). Rest between shifts is separate, and only warns |
| Anchor changes | Changing an assignment, a department default or the organization's day-start time recalculates the range it affects, because those are the only inputs to a day's boundary anchor (§5.2) |
| Day facts rebuild | Any shift change runs `refreshDayFacts` for the changed day and both neighbours **before** re-attribution, so `window_start`, `window_end` and `close_due_at` follow the new shifts — including a next-day change that moves today's `closingCap` (§8.5) |

### 6.4 API

| Method | Path | Action | Notes |
|---|---|---|---|
| GET | `/api/shifts` | `shifts:view` | Templates with their current version |
| POST | `/api/shifts` | `shifts:manage` | Template and first version |
| PATCH | `/api/shifts/:id` | `shifts:manage` | New version with an effective date (default tomorrow), or `status: inactive` |
| GET | `/api/shifts/assignments` | `shifts:view` | Assignments; with `userId, from, to` it returns the resolved shift and its source per date — the "why this shift" explorer |
| POST | `/api/shifts/assignments` | `shifts:manage` | Template, rotation, permanent-flexible, date override or department default |
| POST | `/api/shifts/requests/:id/decide` | `shifts:approve` | Approve or reject |
| POST | `/api/shifts/requests` | *proposed* `shifts:request` | **G3** — no route exists to raise a request |
| GET | `/api/shifts/requests` | *proposed*, `shifts:view` | **G3** — no route exists to list requests |

### 6.5 Screens and seed

- `/company/workforce/shifts` (templates, assignment board) and
  `/company/workforce/shifts/requests` (queue). The client keeps its existing
  `/company/...` prefix, as the access-management design did.
- Seed (TECH §17.1 step 9): the five shifts Tapvera uses today — 09:00–18:00,
  05:30–14:30, 08:15–17:15, 06:00–15:00, 08:00–17:00 — created **inactive**
  until HR enters grace and thresholds (Q1, Q4). A template without them cannot
  be assigned, and the go-live checklist lists it.

### 6.6 Night shifts, end to end

The product is sold mainly into the Indian market, where one company commonly
runs a morning shift and a night shift at the same time — 09:00–18:00 for the
office and 20:00–05:00 for support, operations or a BPO desk. Creating the
night shift is the same form; only the end time changes. Everything below
follows from `end_time < start_time`, which is what makes a shift overnight.

**Definition.** `start 20:00`, `end 05:00` → `is_overnight = true` (strictly
`end < start`), scheduled minutes = (24:00 − 20:00) + 05:00 = **540**. The
editor shows "20:00 → 05:00 (next day) · 9 h 00 m", so nobody saves a 9-hour
shift believing it is 15. **Equal start and end times are refused** with
`SHIFT_START_END_MUST_DIFFER`: 20:00 → 20:00 is a typing slip, and treating it
as a 24-hour shift would quietly pay a full day for a single scan. If a genuine
24-hour pattern ever comes up it needs its own decision, not a fall-through.
Full-day and half-day minutes are HR's, as for any shift (Q1).

**Which day the hours belong to.** The shift that *starts* on the 26th is the
26th's day, whatever the clock reads at the punch-out (SH-3). The boundary rule
(§5.2) puts the whole night on the start date — for night-after-night the gap
is 05:00 → 20:00 and the boundary falls at 12:30:

| Event | Local time | Work date |
|---|---|---|
| Arrival | 19:52 on the 26th | 26th |
| Break | 00:30 on the 27th | 26th |
| Departure | 05:06 on the 27th | 26th |
| A scan at 13:10 on the 27th, coming in for something else | — | 27th, and **outside that day's attendance window**, so it is recorded and flagged, not read as an arrival (§8.2) |

Rotations between shift types are the same arithmetic, which is why a person
can move between them mid-week without a special rule:

| Yesterday → today | Gap | Boundary | Effect |
|---|---|---|---|
| Night (ends 05:00) → night (starts 20:00) | 15 h | 12:30 | The night sits on its start date |
| Night (ends 05:00 Mon) → morning (starts 09:00 Mon) | 4 h | 07:00 Mon | A 05:20 punch-out is still Sunday's night; an 08:50 arrival is Monday |
| Morning (ends 18:00 Mon) → night (starts 20:00 Tue) | 26 h | 07:00 Tue | An 18:40 punch-out stays on Monday; a 19:50 arrival starts Tuesday |

**The board and `/today`.** A person's current day is what `currentDayFor`
answers (§5.2), never today's calendar date. At 02:00 the night worker is still on
the 26th and shows `WORKING`, while the morning staff are `NOT_IN` for the
27th. Anyone whose day is not today's date is shown with their work date
beside them, so an HR viewer at 10:00 sees both groups without having to work
it out. All times render in the organization timezone (LS-10).

**Holidays and week-offs.** A holiday on the 26th is the shift that *starts*
on the 26th, so the night worker's holiday runs 20:00 on the 26th to 05:00 on
the 27th, and the night of the 25th is an ordinary working night. A Sunday
week-off likewise means the shift starting Sunday evening. This is exactly the
PRD's "a night-shift employee's holiday is not the same 24 hours" (§9.9).

**Half-days.** A half day is half of the *shift*, not half of the clock: the
first half of 20:00–05:00 is 20:00–00:30 and the second is 00:30–05:00 (for
09:00–18:00 it is 09:00–13:30 and 13:30–18:00). Half-day leave, and the
"worked the other half" test in the calculator, both use that split.

**Lateness, early exit and overtime** are one instant minus another, so
midnight is not special: arriving 20:14 is 14 minutes late, leaving 04:30 is
30 minutes early, staying until 06:10 is 70 minutes past the shift.

**Auto-close** is due at `closingCap` — 05:00 + 4 h = 09:00 on the 27th, or the
next shift's start if that comes first — **not** at the geometric boundary
(12:30 for night-after-night, 07:00 when a morning shift follows). An earlier
revision capped it at the day window and would have closed the night at 07:00
while attribution still accepted a 07:30 punch-out into it. The hourly job
selects by due time, so a night day closes like any other (§12.3).

**Overtime past a night shift stays with the night.** A break at 07:10, its end
at 07:20 and the punch-out at 07:30 all belong to the session that is still
open, not to the morning that geometry says has begun (§5.2) — until the
person's next shift starts. From that arrival on, events are the new day's, and
a night that was never closed goes to review with its departure unconfirmed.

**Device punches** need nothing special: a scan at 04:55 falls inside the
26th's window, so it lands on the 26th. Duplicate, skew and unmapped handling
are unchanged.

**Payroll at a month end.** A shift starting 20:00 on 31 March and ending
05:00 on 1 April is one working day **in March**, because payroll counts work
dates, not clock dates. Nobody is paid twice, and nobody loses a night at a
month boundary.

**Night allowance.** Where an organization pays one — common in India, and not
a fixed statutory amount — it is a payroll line driven by attendance rather
than typed in each month. Attendance records the **fact** per day:
`night_minutes`, the minutes that day's worked time spent inside the
organization's night window. The window is an attendance setting
(`attendance_setting`, dated), because attendance measures the minutes and may
not read payroll's configuration. Payroll applies the **policy**: a day
counts as a night when its night minutes reach
`minimum_night_minutes_for_night_day` (Q13 — a number HR sets; without it one
minute inside the window would earn a whole night's allowance), and the
month's night days and night minutes both come from the frozen snapshot, so a
policy change cannot rewrite a published month. `payroll_config` then holds
**one** of two methods, never a mix:

```
night_day   = day where night_minutes >= minimum_night_minutes_for_night_day
per-night   = amount_per_night × count(night_days)
hourly      = rate_per_hour    × (total night_minutes ÷ 60)     -- no threshold needed
```

The formula quoted around Indian payrolls, `(Basic + DA) ÷ 200 × night hours ×
night nights`, is the hourly method written for a single night: its "night
hours" means hours *per night*. Since the frozen days carry their night
minutes, the hourly method multiplies once, by the month's total —
writing it with both factors would pay the allowance many times over. Where an
organization uses the conventional divisor, `rate_per_hour` is
`(Basic + DA) ÷ 200`, which the config stores as a formula rather than a typed
number so a salary change flows through. The line appears as its own payslip
entry (PY-9) and joins the PF wage base when the organization pays it to
everyone who works nights. Method and amounts are HR's and the CA's (Q13).

**Night-work conditions.** India's OSH Code (section 43) allows women to be
employed before 6 a.m. and after 7 p.m. with their consent, under the safety,
holiday and working-hours conditions the appropriate government prescribes —
typically written consent, safe transport both ways and security arrangements —
and state shops-and-establishments rules add their own. The product encodes
none of that as law and infers nothing about whom the rules cover. Instead: HR
marks the employees whose night assignment needs consent, records the consent
(date, validity, document reference) and the transport arrangement in
`night_work_consent`, and the assignment board refuses — or warns, by setting —
when a night shift is assigned without a valid record. The consent hours and
the strictness are `shift_setting` values (Q14). Confirm the details for your
states with your CA or labour advisor; they differ, and they change.

**Rest between shifts.** Two different things, deliberately: shifts that
*overlap* are refused outright (§5.2), because the hours would otherwise
belong to two days at once; shifts that merely leave a short gap raise a
warning on the assignment board when an optional minimum rest is configured —
off by default, because the number varies by state and industry.

No screen is night-shift-only. The same shift editor, board, attendance portal
and payroll run handle both, which is the point.

**Done when** the explorer shows the right shift and source for any person and
date; a template edit changes nothing before its effective date; a past-dated
change by someone without `attendance:correct` is refused; and a 20:00–05:00
shift produces one day on its start date, with correct lateness, no double
counting, and the right month at a month end.

---

## 7. Step 2 — Holidays and week-offs

**In plain words.** One calendar says, for any person on any date, whether it is
a working day, a week-off or a holiday — respecting the department and the
shift.

```sql
CREATE TABLE holiday (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  name            text NOT NULL,
  type            text NOT NULL CHECK (type IN ('national', 'regional', 'optional', 'week-off')),  -- HO-1
  holiday_date    date,                    -- dated holidays
  recurrence      jsonb,                   -- week-off only, e.g. {"weekdays":[6],"weeksOfMonth":[2,4]}
  effective_from  date,                    -- week-off rules
  effective_to    date,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'withdrawn')),
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),                -- the target of holiday_scope's composite key
  CHECK ((type = 'week-off') = (recurrence IS NOT NULL)),
  CHECK (type = 'week-off' OR holiday_date IS NOT NULL)
);

-- Scope as rows with TYPED columns. A (scope_type, scope_id) pair cannot carry a
-- foreign key, so each target gets its own column and exactly one is set.
CREATE TABLE holiday_scope (
  organization_id uuid NOT NULL,
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
```

The same rule holds everywhere in this design: a reference is a typed column
with a real foreign key, never a `(type, id)` pair. Where a row genuinely has
two possible parents — an overlay from leave or from a break breach — it gets
one nullable column per parent and a `CHECK` that exactly one is filled.

`CalendarFacade.dayType(tx, userId, date, shift)`:

1. An active dated holiday on that date whose scope matches — national applies
   to all; regional to its departments; shift-scoped (HO-2) to people whose
   resolved shift *starting that date* is in scope, so a night shift's holiday is
   the shift that begins on the holiday. An optional holiday counts only if the
   person claimed it (G9).
2. Otherwise a matching week-off rule.
3. Otherwise a working day.

| Rule | How |
|---|---|
| HO-3 | Declaring or withdrawing a holiday queues recalculation for the affected people and date. Punches stay; a worked holiday is flagged `holiday-worked`, which is what comp-off eligibility reads. A change inside a published payroll period flags the payslip (§4 outbox) instead of changing it |
| HO-4 | `GET /api/holidays` is readable by every employee (the matrix gives `holidays` at `all-ppl*`) |

API: `GET /api/holidays` (`holidays:view`), `POST /api/holidays` and
`PATCH /api/holidays/:id` (`holidays:manage`; withdrawal is `status: withdrawn`).
Week-off rules are holidays of type `week-off`, so they need no extra route.

Seed (TECH §17.1 step 10): the current year's holidays as HR supplies them,
and a Saturday + Sunday week-off rule pending HR confirmation (Q11).

**Done when** the calendar returns the right day type per person and date, and
declaring a holiday on a worked day marks it `holiday-worked` without removing
a single punch.

---

## 8. Step 3 — Attendance core

**In plain words.** Punches are stored as a list that is only ever added to.
For each person and day there is exactly one record holding the answer: hours,
lateness, status, and how much of the day is paid. The answer is recomputed by
one pure function whenever an input changes, and stored. Nothing reads the raw
list to work the answer out again.

### 8.1 Tables

```sql
CREATE TABLE attendance_event (                 -- append-only (AT-6)
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  user_id             uuid NOT NULL,
  kind                text NOT NULL
                        CHECK (kind IN ('in', 'out', 'break-start', 'break-end', 'scan', 'auto-out')),
  occurred_at         timestamptz NOT NULL,       -- corrected instant; the owning day is in
                                                  -- attendance_event_assignment, not here (§5.2)
  source              text NOT NULL
                        CHECK (source IN ('device', 'web', 'mobile', 'correction', 'system', 'import')),
  evidence            text NOT NULL               -- stamped once, never re-derived (D29, §9.1)
                        CHECK (evidence IN ('confirmed', 'assumed')),
  biometric_punch_id  uuid,                       -- source = device
  correction_id       uuid,                       -- source = correction
  supersedes_event_id uuid,                       -- the earlier event this one replaces or voids
  is_void             boolean NOT NULL DEFAULT false,
  -- A void row is written by a correction, or by the system when a re-derived closure
  -- retires an auto-out (§12.4) or an earlier punch displaces its duplicate (§10.3); a
  -- device or web punch is a fact and never supersedes anything on its own.
  CHECK (supersedes_event_id IS NULL OR source IN ('correction', 'system')),
  remote              boolean NOT NULL DEFAULT false,   -- a web/mobile punch
  client_event_id     text,                       -- offline queue idempotency (NF-19, TX-7)
  client_request_hash text,                       -- same key + different request = 409
  client_time         timestamptz,                -- what an offline client said (D13)
  recorded_by         uuid,                       -- NULL for device and system events
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, user_id, id),             -- target key for same-person supersession
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, user_id, supersedes_event_id)
    REFERENCES attendance_event (organization_id, user_id, id),
  CHECK ((source = 'device') = (biometric_punch_id IS NOT NULL)),
  CHECK (source <> 'correction' OR correction_id IS NOT NULL),
  CHECK (correction_id IS NULL OR source IN ('correction', 'system')),  -- a system row may carry
                                                                        -- the correction behind it (§10.6)
  CHECK (NOT is_void OR supersedes_event_id IS NOT NULL),
  CHECK (supersedes_event_id IS NULL OR supersedes_event_id <> id),
  -- A scan and a system auto-out are never confirmed; a web or mobile punch always is.
  CHECK (kind NOT IN ('scan', 'auto-out') OR evidence = 'assumed'),
  CHECK (source NOT IN ('web', 'mobile') OR evidence = 'confirmed'),
  -- A person states when someone arrived, left or took a break: never a scan or an
  -- auto-out, and always confirmed. A void row copies its target, whatever that was.
  CHECK (source <> 'correction' OR is_void
         OR (evidence = 'confirmed' AND kind IN ('in', 'out', 'break-start', 'break-end'))),
  -- Whole seconds (T-6): two events in one second are a tie the order of §5.3 decides,
  -- never a microsecond race won by whichever request happened to run first.
  CHECK (date_trunc('second', occurred_at AT TIME ZONE 'UTC') = occurred_at AT TIME ZONE 'UTC')
);
CREATE INDEX ix_attendance_event_user_time ON attendance_event (organization_id, user_id, occurred_at);
CREATE UNIQUE INDEX ux_attendance_event_client
  ON attendance_event (organization_id, user_id, client_event_id) WHERE client_event_id IS NOT NULL;
-- One chain, never a fork: an event can be superseded or retracted once and once only,
-- whether by a correction (§12.1), a re-derived closure (§12.4) or a displaced
-- duplicate (§10.3).
CREATE UNIQUE INDEX ux_attendance_event_supersedes
  ON attendance_event (organization_id, supersedes_event_id) WHERE supersedes_event_id IS NOT NULL;
SELECT apply_tenant_rls('attendance_event');
GRANT SELECT, INSERT ON attendance_event TO tapcrm_app;      -- no UPDATE, no DELETE

-- attendance_event_assignment follows attendance_record below: it points at both,
-- and a foreign key needs its target table to exist first.

CREATE TABLE attendance_record (
  id                       uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id          uuid NOT NULL REFERENCES organization(id),
  user_id                  uuid NOT NULL,
  work_date                date NOT NULL,
  window_start             timestamptz NOT NULL,  -- §5.2
  window_end               timestamptz NOT NULL,
  state                    text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'closed')),
  close_due_at             timestamptz NOT NULL,  -- = closingCap (§5.2). NOT capped by window_end:
                                                  -- a night's session may legitimately close after
                                                  -- the geometric boundary has passed
  shift_snapshot           jsonb NOT NULL,        -- ResolvedShift (SH-2, AT-I2): bounded, owned by the row
  shift_source             text NOT NULL,
  placement_snapshot       jsonb NOT NULL,        -- department, team and position on that date (see below)
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
  night_minutes            integer NOT NULL DEFAULT 0,    -- worked minutes in the night window (§6.6)
  arrival_at               timestamptz,           -- readDay's arrival and departure (§5.3),
  departure_at             timestamptz,           -- written by the calculator
  is_wfh                   boolean NOT NULL DEFAULT false,
  flags                    text[] NOT NULL DEFAULT '{}',
  provenance               jsonb NOT NULL DEFAULT '{}',   -- AT-12
  input_version            integer NOT NULL DEFAULT 1,    -- bumped by every input change
  calculated_input_version integer NOT NULL DEFAULT 0,
  calculation_version      integer NOT NULL DEFAULT 0,    -- AT-I3
  breaks_evaluated_version integer,                       -- break-management's watermark (§13)
  rules_version            text NOT NULL,                 -- the calculator's code version
  calculated_at            timestamptz,
  closed_at                timestamptz,
  closed_by                text CHECK (closed_by IN ('punch-out', 'auto-close', 'no-show', 'correction')),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, user_id, id),                 -- the assignment's same-person key (D34)
  UNIQUE (organization_id, user_id, work_date),          -- ux_attendance_day (TECH §5.5)
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id),
  CHECK (present_units + paid_leave_units + unpaid_leave_units + absent_units + holiday_units
         = CASE WHEN status IS NULL OR status IN ('not-evaluated', 'not-employed') THEN 0 ELSE 2 END)
);
CREATE INDEX ix_attendance_date     ON attendance_record (organization_id, work_date);    -- TECH §5.5
CREATE INDEX ix_attendance_open_due ON attendance_record (organization_id, close_due_at) WHERE state = 'open';
CREATE INDEX ix_attendance_stale    ON attendance_record (organization_id, user_id)
  WHERE calculated_input_version < input_version;

-- Which day owns an event, and why. Derived, so unlike the event itself it can be
-- rewritten when a later change moves an event across a boundary (§8.4). Created
-- after attendance_record, because it references it.
CREATE TABLE attendance_event_assignment (
  organization_id      uuid NOT NULL REFERENCES organization(id),
  user_id              uuid NOT NULL,             -- whose event, and whose day: one person
  event_id             uuid NOT NULL,
  attendance_record_id uuid NOT NULL,
  reason               text NOT NULL CHECK (reason IN ('midpoint', 'closing-extension',
                                                       'opening-pull-forward', 'next-shift-started',
                                                       'system-close', 'reconciliation',
                                                       'correction', 'import')),
  -- A pinned assignment is never moved by automatic re-attribution: a human decided it,
  -- or it is one of the system's own rows for that day — a closing auto-out (§12.3), or a
  -- void row retiring an auto-out (§12.4) or a displaced duplicate (§10.3).
  pinned               boolean NOT NULL,
  assignment_version   integer NOT NULL DEFAULT 1,
  assigned_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, event_id),
  -- Both keys carry user_id, so an event can only be assigned to its own person's day (D34).
  FOREIGN KEY (organization_id, user_id, event_id)
    REFERENCES attendance_event  (organization_id, user_id, id),
  FOREIGN KEY (organization_id, user_id, attendance_record_id)
    REFERENCES attendance_record (organization_id, user_id, id),
  CHECK (pinned = (reason IN ('correction', 'system-close', 'reconciliation')))
);
CREATE INDEX ix_event_assignment_record ON attendance_event_assignment (organization_id, attendance_record_id);
SELECT apply_tenant_rls('attendance_event_assignment');
GRANT SELECT, INSERT, UPDATE, DELETE ON attendance_event_assignment TO tapcrm_app;

-- Leave, WFH and confirmed break consequences, each pointing at what created it (L8),
-- through a typed column with a real foreign key.
CREATE TABLE attendance_overlay (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  user_id          uuid NOT NULL,
  work_date        date NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('leave-full', 'leave-first-half', 'leave-second-half',
                                                 'wfh', 'breach-consequence')),
  paid             boolean,                                  -- leave kinds
  consequence      text CHECK (consequence IN ('mark-late', 'mark-half-day', 'mark-absent', 'deduct-minutes')),
  minutes          integer,                                  -- deduct-minutes
  leave_request_id uuid,
  break_breach_id  uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(leave_request_id, break_breach_id) = 1),
  CHECK ((kind = 'breach-consequence') = (break_breach_id IS NOT NULL)),
  -- The request or breach is the same person's (D34).
  FOREIGN KEY (organization_id, user_id, leave_request_id)
    REFERENCES leave_request (organization_id, user_id, id),
  FOREIGN KEY (organization_id, user_id, break_breach_id)
    REFERENCES break_breach  (organization_id, user_id, id),
  -- NULLS NOT DISTINCT matters most here: one of the two reference columns is always
  -- NULL, so a plain UNIQUE would allow the same consequence to be applied twice and
  -- the day would be judged on a doubled deduction.
  UNIQUE NULLS NOT DISTINCT (organization_id, user_id, work_date, kind,
                             leave_request_id, break_breach_id)
);
CREATE INDEX ix_attendance_overlay_leave  ON attendance_overlay (organization_id, leave_request_id);
CREATE INDEX ix_attendance_overlay_breach ON attendance_overlay (organization_id, break_breach_id);

-- Organization-wide attendance settings, dated (D35): a day is judged by the row in
-- force on its date, so a change applies from its own date and leaves earlier days alone.
CREATE TABLE attendance_setting (
  id                            uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id               uuid NOT NULL REFERENCES organization(id),
  effective_from                date NOT NULL,
  arrival_policy                text NOT NULL DEFAULT 'device-or-web'   -- D10, Q6
                                  CHECK (arrival_policy IN ('device-or-web', 'device')),
  client_time_tolerance_minutes integer NOT NULL DEFAULT 15               -- D13
                                  CHECK (client_time_tolerance_minutes BETWEEN 0 AND 1440),
  night_window_from             time,                   -- §6.6, Q13: NULL = no night minutes
  night_window_to               time,
  created_by                    uuid NOT NULL,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, effective_from),
  CHECK ((night_window_from IS NULL) = (night_window_to IS NULL)),
  CHECK (night_window_from IS NULL OR night_window_from <> night_window_to)
);

-- "Office staff scan to arrive" (Q6): a department may differ from the organization, from
-- a date. The department is the one in the day's placement snapshot (§8.1 below).
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
  EXCLUDE USING gist (organization_id WITH =, department_id WITH =,
                      daterange(effective_from, effective_to, '[)') WITH &&)
);

-- The one other way through a `device` policy: a dated, audited allowance for one person
-- on one day (§9.2).
CREATE TABLE arrival_exception (
  organization_id uuid NOT NULL REFERENCES organization(id),
  user_id         uuid NOT NULL,
  work_date       date NOT NULL,
  reason          text NOT NULL CHECK (char_length(reason) >= 20),
  granted_by      uuid NOT NULL,
  granted_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id, work_date),
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id),
  CHECK (granted_by <> user_id)                         -- nobody excuses their own arrival
);

-- Day-open's watermark (§8.6): the last date fully materialised, one row per organization.
CREATE TABLE attendance_day_open_state (
  organization_id      uuid PRIMARY KEY REFERENCES organization(id),
  materialised_through date NOT NULL
);

-- leave_request and break_breach arrive in steps 6 and 8, so their two foreign keys are
-- added by those migrations (forward-only, ALTER TABLE ADD CONSTRAINT), and each of those
-- tables carries UNIQUE (organization_id, user_id, id) for them; the columns and the
-- CHECKs exist from step 3. attendance_event's biometric_punch_id and correction_id follow
-- the same pattern: their same-person keys are added in steps 5 and 7, when
-- biometric_punch and attendance_correction arrive (§10.4, §12.1).
```

**Every link between two of one person's rows includes the person** (D34). An
assignment joins an event to a day, and both belong to someone, so both of its
foreign keys carry `user_id`: `(organization_id, user_id, event_id)` into
`attendance_event` and `(organization_id, user_id, attendance_record_id)` into
`attendance_record`. A bug that assigned one person's punch to another person's
day is refused by the database instead of being paid. The same shape is used
wherever two person-owned rows meet: supersession (above), a device event and
its raw punch in both directions, a duplicate punch and the head of its burst
(§10.4), a correction's rows and the correction (§12.1), an overlay and its
leave request or breach (above), a payroll input and its breach, a payslip
revision and the payslip it replaces (§14.1), and a shift override and the
request that created it (§6.1).

**Effective-event rule — one helper, everywhere** (D28). `effectiveEventsOf(...)`
is a repository operation, not a convention each caller reimplements. For the
requested person and day, or neighbourhood, it starts from assigned ledger rows
and returns an event **iff** `is_void = false` and no `attendance_event` row
names it in `supersedes_event_id`. A replacement row (`is_void = false`) can
itself be superseded, so only the tail of a replacement chain survives; a void
row is a tombstone, never an attendance action, and therefore never appears in
`AttendanceEventInput`, `calculate()`, `replay()`, attribution or
session-openness checks. The same helper feeds `attributeEvent`,
`currentDayFor`, step-7 interactive validation, `calculate`, `closeDecision`
and projector `refresh`; no consumer hand-rolls "not superseded" logic. The
existence check is one probe of `ux_attendance_event_supersedes` per event.

A void row copies its target's `kind`, `occurred_at` and `evidence` only so the
append-only ledger stays self-describing; it is assigned to the target's work
date with its pinned `correction` or `reconciliation` reason, and the rule above
guarantees it is never replayed as a punch. The self-referencing foreign key on
`(organization_id, user_id, supersedes_event_id)` makes the target real and
owned by the same person, the unique supersedes index prevents forks, and the
self-reference check stops an event superseding itself. The last property
comes from how rows are written: correction and system rows always take
database-generated ids — the repository never supplies one, and a repository
test asserts it — so a row can only name a row that already existed, and no two
rows can name each other. Together those make `supersedes_event_id` a one-way
chain rather than a UUID-shaped pointer.

**Evidence is stamped once** (D29). Web and mobile punches, events a correction
adds (the database enforces both), and device events read through an `entry`,
`exit` or `both-trusted` reader are `confirmed`; events from an `alternating` or
`undirected` reader, a scan from a `both-trusted` reader whose key the map does
not know, and every system `auto-out` are `assumed` (§9.1); a void row copies
its target's, as above. For a device event the value comes from the reading its
raw punch was given when it arrived (D37); it is written with the event and
never looked up again, so a reader reconfigured next year — or while a punch
waits to be replayed — cannot change how that punch is judged. Imported history
carries what the source recorded (§19).

Also `attendance_month_summary` (one row per person per month: unit totals,
WFH days, late count and minutes, overtime, `night_minutes`, open and
not-evaluated days — no night-day count, because what makes a night is
payroll's threshold, applied to the frozen days, §6.6). It is
derived, maintained in the same transaction as each recalculation, and can be
rebuilt at any time. Monthly screens read it, which keeps the monthly view far
inside its 4-second budget (NF, TECH §18).

**Why a placement snapshot.** The directory keeps no history of who sat in
which department, so anything that reads the *current* department to judge a
*past* day is wrong after a transfer — the department's default shift (chain
step 6) and any department-scoped holiday. Each day therefore stores the
person's department, team and position as they were when the day was
materialised, and recalculation of a past day reads that snapshot, not the
directory. Real effective-dated placement history belongs to
`employee-directory`; when it lands, the snapshot becomes a cache of it rather
than the only record.

The correction and review-queue tables belong to step 7 (§12).

### 8.2 The calculator

`calculate(input): CalculatedAttendance` in `attendance/calculate.ts`. Pure: no
clock, no database, no configuration lookup (AT-I1). Its input is everything the
day depends on — effective events, the shift snapshot, the calendar day type,
overlays, confirmed break consequences, the employment window, the break-pay
setting and the night window in force on the date — so replaying a day a year
later gives the same answer, and `rules_version` says which code produced it.

In order:

1. **Employment.** A date outside the person's employment window is
   `not-employed`, zero units.
2. **Effective events.** The caller builds the input from `effectiveEventsOf`
   (§8.1): superseded ledger rows and every `is_void = true` tombstone are
   already absent, and `calculate` itself never queries. They are read in the
   order of §5.3 — by second, then by kind — never by id.
3. **Eligibility.** A day's events are the ones assigned to it
   (`attendance_event_assignment`, §8.1) — never "whatever timestamp falls
   between two bounds", which is what made the 07:30 case contradict itself.
   Among those, not everything is working time. Each day has an **eligibility
   window**, `[shift start − early window, closingCap]` (§5.2), which is **not
   clipped to the day window** and may overlap its neighbour's — the same late
   edge that decides when the day closes (§12.3), by construction rather than
   by coincidence. Events outside it are
   **stored, flagged `outside-shift-window`, and cannot become the arrival or
   the departure**; they open a review item, and a correction can include one
   when it was genuine: an event a correction adds counts wherever it falls,
   because a person has decided it was real (D36). Flexible and no-shift days
   have no shift window, so everything assigned to them is eligible.

   Two cases show why the two windows must be different. A 07:30 punch-out
   assigned to a 20:00–05:00 night by the closing extension is *outside* that
   night's day window (which ended at 07:00) but *inside* its eligibility
   window (17:00 → 09:00), so it closes the session, as it should. A 13:10
   errand scan on the following day is *inside* that day's window but nowhere
   near its eligibility window, so it is recorded, visible, and ignored by the
   arithmetic until a human says otherwise — no fifteen-hour shift invented.
   Nothing is ever discarded; TapCRM's mistake was the opposite one, dropping
   what it could not explain.
4. **Arrival and departure** — from `readDay` (§5.3, D31): the first eligible
   `in` or `scan`, and the first eligible `out` or `auto-out` after it in the
   order. Every closed day with an arrival has a departure, because a
   closure without a real `out` always writes an `auto-out` (§12.3). **Anything
   after the departure is evidence, not time**: a second `out`, a scan, an `in`
   or a break in a later second is kept and flagged `activity-after-finish`,
   and never changes worked minutes — a double exit swipe at 05:00 and 05:10
   is a 05:00 departure. To move a departure, a reviewer replaces it
   (`replace-event`, §12.1). An `out` with no arrival before it — the `09:05
   out` of §5.2 — cannot be a departure either; it is kept and flagged
   `departure-without-arrival`, or `same-instant-conflict` when it shares the
   arrival's own second.
5. **Breaks** — the `ON_BREAK` stretches of the same reading: each runs from a
   `break-start` to the `break-end`, scan or departure that ends it, so a break
   still open at departure ends at departure, and a start and an end in one
   second are a zero-length break. An undirected `scan` while on break ends the
   break and is marked as an assumption, the same way the board marks it
   (§9.1) — on a door with an exit reader the question does not arise, because
   the scan is an `out`.
6. **Minutes.** Worked = departure − arrival, minus break time only when break
   time is unpaid (D19), minus any confirmed `deduct-minutes`. The **worked
   stretches** — arrival to departure, less any unpaid break stretch — are also
   what the half-day test reads (§8.3) and what `night_minutes` measures: the
   part of them inside the organization's night window, on whichever dates the
   day spans (§6.6).
7. **Shift facts** (fixed shifts only; flexible and no-shift days are exempt):
   - lateness = arrival − (shift start + grace), never negative (AT-4);
   - early exit = (shift end − early-exit grace) − departure, never negative;
   - overtime = worked − scheduled minutes, only when that is at least the
     shift's minimum, and only on working days (AT-5);
   - **overtime that rests on an assumed departure is recorded but not
     credited.** When the departure's evidence is `assumed` — any `auto-out`,
     or an `out` from an `alternating` reader — and the day shows overtime, it
     is flagged `overtime-unconfirmed` and a review item names the minutes:
     "departure taken from a scan at 08:30, 3 h 30 m after the shift ended:
     confirm or correct". Payroll cannot publish with it open (PY-7). The rule
     lives here, not in auto-close, so it holds however the day came to be
     closed — on time, after a no-show, or after late evidence (§12.4). It is
     the break-penalty principle (BM-5) applied to the evidence a one-reader
     site can actually produce.
8. **Status and units** by the fixed precedence below (AT-3).
9. **Flags and provenance.** Late, early exit, overtime, WFH, remote without
   approval, holiday worked, punched on leave, missing punch-out, departure
   without arrival, an `out` in the arrival's own second, auto-closed with an
   assumed time, overtime on an assumed departure, previous session unconfirmed,
   closure re-derived, outside the shift window, overlapping shift windows, not
   evaluated; plus the shift source, event ids, correction ids, leave request,
   holiday and breach ids (AT-12).

A day with `kind: 'none'` records hours and is `not-evaluated`. Payroll will not
run for a person with not-evaluated working days in the period; it names them,
so HR assigns a shift first rather than someone being paid on a guess.

### 8.3 Status precedence (AT-3)

One ordered function, table-tested, with the order in the test's title (AT-I5):

```
1. holiday or week-off   → holiday            units: holiday 2
2. approved full leave   → leave              units: paid-leave 2 or unpaid-leave 2
3. approved half leave   → half-day-leave     units: leave 1 + (worked IN THE OTHER HALF ≥ half-day ? present 1 : absent 1)
4. worked ≥ full-day     → present            units: present 2
5. worked ≥ half-day     → half-day           units: present 1, absent 1
6. otherwise             → absent             units: absent 2
```

- A "half" of a day is half of the **shift**, not half of the clock: the split
  is the shift's start plus half its scheduled minutes, so 20:00–05:00 splits
  at 00:30 and 09:00–18:00 at 13:30 (§6.6).
- **Branch 3 measures the half that was not on leave**, as an interval
  intersection rather than a daily total:

  ```
  workedForPresence = minutes( intersect(workIntervals, complementHalf) )
      workIntervals     = the worked stretches of §8.2 step 6
      leave first half  → complementHalf = [split, shift end]
      leave second half → complementHalf = [shift start, split]
      split             = shift start + scheduled minutes ÷ 2
  present 1 when workedForPresence >= complementary_half_minutes, else absent 1
  ```

  **The threshold for a half cannot be the threshold for a day.** A 20:00–05:00
  shift is 540 minutes, so each half holds 270; an HR setting of
  `half_day_minutes = 300` would make this branch impossible to satisfy and
  quietly mark every half-leave day absent. So `complementary_half_minutes`
  defaults to `half_day_minutes ÷ 2` — the same standard HR chose, applied to
  half the day, which is always achievable — and 300 becomes 150 of the 270
  available. HR can set it explicitly per shift; saving is refused when it
  exceeds the half, and the editor says it in words: "at least 2 h 30 m of that
  4 h 30 m half".

  A daily total would pay a full day to someone on first-half leave who worked
  09:00–13:30 — straight through their own leave — and then went home: they
  were absent for the half they were expected. On a 20:00–05:00 night the same
  case is 20:00–00:30 worked against first-half leave, and the halves cross
  midnight, which is precisely why the test has to be an intersection of
  instants and not a comparison of hours. Work done inside the leave half still
  counts in `worked_minutes` and shows on the day; it simply does not buy the
  other half.
- WFH is a flag, never a status (AT-12b). The day is judged by hours exactly as
  in the office (WFH-3, WFH-4), so an approved WFH day on which nobody works is
  absent, not present: the approval says where a person may work, not that they
  did (G16). A device scan on a WFH day clears the flag (WFH-9). The flag
  travels with the day everywhere (WFH-5): a WFH badge on the board instead of a
  location, the portal and the day detail, a count of its own in the month
  summary, and an ordinary paid working day in payroll.
- Confirmed break consequences apply only in branches 4–6: `mark-half-day`
  caps present at 1, `mark-absent` sets it to 0, `mark-late` adds the flag.
  Under branches 1–3 they are recorded as "superseded by leave" (BM-14).
- Worked minutes on a holiday or a leave day never change the status; they set
  `holiday-worked` or `punched-on-leave`, which go to the review queue.

Worked examples (thresholds are illustrative — the real ones come from Q1):

| Day | Status | Present / paid leave / unpaid leave / absent / holiday |
|---|---|---|
| Worked 9 h on a 09:00–18:00 shift | present | 2 / 0 / 0 / 0 / 0 |
| Worked 30 minutes | absent | 0 / 0 / 0 / 2 / 0 |
| Worked between the half-day and full-day thresholds | half-day | 1 / 0 / 0 / 1 / 0 |
| First-half paid leave, then worked the afternoon | half-day-leave | 1 / 1 / 0 / 0 / 0 |
| First-half unpaid leave, no punch | half-day-leave | 0 / 0 / 1 / 1 / 0 |
| First-half paid leave, but worked 20:00–00:30 of a night shift and left | half-day-leave | 0 / 1 / 0 / 1 / 0 |
| Approved WFH, full day worked from home | present, WFH | 2 / 0 / 0 / 0 / 0 |
| Approved WFH, never punched | absent | 0 / 0 / 0 / 2 / 0 |
| Saturday week-off | holiday | 0 / 0 / 0 / 0 / 2 |

Compare TapCRM (scan §5): 30 minutes paid a full day, approved WFH with no punch
paid a full day, and half-day leave cost more than a full day off.

### 8.4 Appending an event

`AttendanceFacade.appendEvent(tx, event)`:

```
1. idempotency, fast path: client_event_id seen before? → return the first result (§9.2)
2. pg_advisory_xact_lock(hash(organization_id, user_id))      one punch at a time per person
3. idempotency AGAIN, now holding the lock          → return the first result
4. attributeEvent(kind, at):  neighbouring shifts + this person's effective events
                              → work date + reason (§5.2)
5. INSERT INTO attendance_record … ON CONFLICT DO NOTHING     materialise the owning day
6. SELECT … FOR UPDATE  by (organization_id, user_id, work_date)
7. interactive punches only — web and mobile — and now against the TARGET day:
       WFH, arrival policy and geofence evaluated for THAT work date (§9.2)
       the move is checked against readDay() over that day's effective events:
         inside the eligibility window, the reading WITH the new punch must
           apply it — so an `out` in the arrival's own second is refused
         outside it, nextState() from the day's state must allow it; the punch
           is then recorded and flagged, like any such event (§8.2 step 3)
       otherwise 422 with allowedMoves() from the state before the punch
   a device scan skips this step: a scan is a fact, not a request (§9.1)
8. INSERT attendance_event (with its evidence)  +  INSERT attendance_event_assignment
   (+ the system void row retiring a duplicate this punch displaced — §10.3 step 7)
9. re-attribute the neighbourhood: the day before, this day, the day after —
   an assignment counts as changed when its record OR its reason changes;
   pinned assignments are left alone; every record that gained, lost or
   re-explained an event bumps input_version, and the assignment bumps
   assignment_version. If an event moves onto or off one of the two outer
   days, the pass repeats one day further out on that side
10. re-derive the closure of every day step 9 touched (§12.4): closeDecision
    over its effective events less its own auto-out, writing only the
    difference — a void row for an auto-out that no longer fits, a new
    auto-out, a no-show turned into a real closure. System rows never feed
    back into attribution, so this cannot loop
11. live board, same transaction (LS-1), and ONLY when the affected day is the
    person's current day (AttendanceFacade.currentDayFor, this event counted)
    or the day their user_status row still describes:
        an eligible punch in a later second than every event on its day,
        when the row already describes currentDayFor(now), this event counted
                     → PresenceProjector.apply(tx, userId, event)
        anything else → PresenceProjector.refresh(tx, userId, now)
12. INSERT domain_outbox 'attendance.recalc-requested' for each touched record
```

**The idempotency check runs twice on purpose.** Two identical retries can both
miss the fast check; then one waits on the lock while the other commits, and
without the second check the waiter would reach the insert and take a unique
violation — the data would be safe, but the caller would get a database error
instead of the answer their first attempt already earned. The fast path keeps
the common case cheap; the check under the lock is the correct one.

**The lock order is the same everywhere: the person's advisory lock first, then
record rows.** Punches, corrections, replays, auto-close, re-attribution and
recalculation all follow it; reversing it anywhere is how this system would
deadlock. A transaction that touches more than one person — a bulk batch of
corrections, a clock correction, the pair of corrections that moves a punch
from one person to another (§12.1) — takes all of their locks first, in
ascending user-id order, and only then any record row, so two such
transactions that share people can only queue, never deadlock. The biometric
pipeline takes one lock before those — its device-and-PIN lock for the
duplicate check (§10.3 step 7) — and nothing else takes that lock, so the order
stays total.

**Why the advisory lock, and why it comes before attribution.** Attribution
now reads the person's own events — "is the previous day still open?" — so two
punches for the same person arriving at the same moment could both read the
same history and decide independently; an `out` at 07:30 and an `in` at 07:31
would each believe the night was open. The row lock cannot help, because the
row to lock is not known until attribution has run. A transaction-scoped
advisory lock keyed on the person is the serialisation point, and it only
serialises that one employee's punches — everyone else proceeds in parallel.
Recalculation and re-attribution jobs take the same lock, so a sweeper cannot
interleave with a live punch.

**Why the interactive checks moved inside the lock (step 7).** They used to
run in the punch route, before attribution, against "the caller's current day".
That is one question too early. A 06:30 web punch-in for a 09:00 shift would be
measured against Sunday's finished night — `FINISHED` does not accept an `in`,
so the punch is refused 422 — while `attributeEvent('in', 06:30)` would have
resolved it to **Monday**, where the person is `NOT_IN` and the punch is
exactly right. The same mismatch hits WFH and the geofence: an employee with
approved WFH on Monday, punching in at 06:30, would be checked against Sunday's
approvals and told to go to the terminal. Attribution has to run first, because
until it has run nobody knows which day's rules apply. Putting the checks at
step 7 also puts them inside the person's advisory lock and inside the same
transaction that writes the event, so the state they validate against is the
state the event is appended to — no window between "the check passed" and "the
row was written".

A device scan never reaches step 7 at all. §9.1 is clear that a scan is
evidence that something happened, not a request for permission; refusing it
would not undo the fact, it would only lose it.

**A refusal at step 7 rolls the whole transaction back**, including the
`attendance_record` row step 5 just materialised. That is deliberate: a rejected
punch must leave nothing behind, and the day row is not lost — day-open creates
it on schedule, and the next accepted event would create it anyway. The refusal
itself is returned as a 422 naming the moves that *are* allowed from the
resolved day's state, with the resolved work date included, so the client can
say "you are still on Sunday night" rather than "not allowed". One refusal needs
its own words: an `out` in the same second as the day's arrival passes
`nextState` from `WORKING` but would not be a departure (§5.3), so it is refused
with that reason, and the same button works a second later. A punch outside
the eligibility window answers to the state machine alone: a move it allows —
a 05:30 punch-in for a 09:00 shift — is kept and flagged for review, because
only the arithmetic will not use it; a move it refuses — an `out` on a day
nobody arrived on — is refused, as it always was.

Steps 5 and 6 are in that order on purpose: "find, else create" loses a race
between day-open and a first punch. The insert-then-lock pair leans on the
`(organization_id, user_id, work_date)` unique index, so one of them is a
no-op and both end up holding the same row (TapCRM L16).

**Why step 9 exists.** Attribution depends on session state, so a new or voided
event can change where a *neighbouring* event belongs. Take Sunday night
`20:00 in`, `05:02 out`, then `07:30 out`: the 07:30 goes to Monday, because
Sunday was already closed. Void the 05:02 and Sunday is open again — the 07:30
now belongs to Sunday. So any change that can alter session openness near a
boundary — an append, a void, a correction, a shift change, a replay or a
backfill — re-runs attribution across the previous, current and next day, in
the order of §5.3, and moves only the assignments that actually change. Pinned
assignments — a human's `correction`, or the system's own `system-close` and
`reconciliation` rows for the day they belong to — are never moved. Because the
re-attribution recomputes from the ordered events rather than from the arrival
order of inserts, the incremental path in step 4 is only an optimisation: the
neighbourhood pass is the authority, and it is what a replay reproduces. An
assignment whose *reason* changes without changing day — a `midpoint` that
becomes a `closing-extension` — counts as a change too, because the reason is
part of the day's provenance and of the calculator's input, and stale
provenance is how "why is this punch here" stops being answerable. The pass
normally stays inside three days. It reaches further only when an outer day
gains or loses an event, which needs shifts packed closer together than twice
the maximum closing extension — only then can one day's session reach into the
next day's window — and it stops as soon as a pass moves nothing at its edges.

**Why step 10 exists.** Auto-close decides a day's ending from the evidence it
has when it runs (§12.3): no events means a no-show, and an arrival with no
`out` gets an `auto-out` at the last scan, the shift end or the last event. A
punch that arrives later changes that evidence — a real `out`, but equally an
arrival after a no-show, or a scan after a shift-end guess — and the only
answer that does not depend on delivery timing is to decide again. So a
closure is not a fact recorded once; it is a function of the day's real
events, applied again whenever they change (D25). Because a closure's own rows
— the `auto-out` and any void row retiring one — are invisible to attribution,
re-deriving can never move an event, and step 10 can never make step 9 run
again.

**Retiring a displaced duplicate.** A device punch that displaces the applied
head of its duplicate burst (§10.3 step 7) retires that head's event. A burst is
one person's (D33), so the event retired is always the same person's as the
punch that displaces it, and it is retired under that person's lock. When the
punch is itself appended, `appendEvent` does it: step 8 writes the system void
row, with a pinned `reconciliation` assignment, beside the new event, so steps
9–12 run once for both and no closure is decided in between. When nothing is
appended — a late punch that bridges two bursts is itself a duplicate —
`AttendanceFacade.retireEvent(tx, eventId, reason)` runs the same sequence
without an insert. Both first check that the event is still effective: if a
correction has already superseded it, nothing is written and a review item
opens instead, because a human decision is changed only by a human.

Step 11 asks two questions, in this order. **First: does this record matter to
the board** — is it the person's current day
(`AttendanceFacade.currentDayFor(userId, now)`, the five-step rule in §5.2, with
this event counted), or the day their `user_status` row still describes? If it
is neither, the board is not touched at all. A late device push for yesterday,
or a correction to last week, changes attendance and nothing else; `user_status`
holds one row per person, so rebuilding it from a historical day would replace
today's `WORKING` with that day's `FINISHED` and leave the board lying until the
next punch. The second half of the question is for the night's own punch-out: a
web `out` at 07:30 closes Sunday, and with it counted the person's current day
is Monday — so a test of the current day alone would skip the board and leave
the row `WORKING` on Sunday until the rollover sweep at 09:00. The row still
describes Sunday, so it is refreshed, and `refresh` rebuilds it as Monday's, not
yet due. **Then: can the cheap path be taken?** Only when the event is eligible
and in a later second than every other effective event on its day (a punch that
shares a second with another is placed by the order of §5.3, not by which
arrived first), no correction or re-attribution is in play, **and** the row
already describes the person's current day with this event counted
(`user_status.work_date = currentDayFor(userId, now)`) — that last part matters,
because an event can itself move the person forward: the 06:30 punch-in resolves
to Monday while the row still says Sunday, and the 07:30 punch-out that ends the
night leaves the row on Sunday while the person is now in Monday. Advancing
Sunday's state machine in either case would write the wrong day into the board
(§9.3). If all three hold, `apply` moves the state machine one step; otherwise
`refresh` rebuilds the person's current day from its own effective events. Both
take the person and the instant, never a record id, so the projection cannot be
pointed at the wrong day by accident.

### 8.5 Recalculation (AT-2, AT-I3, AT-I4)

Triggers: a new event, a correction, an overlay change, a past shift change
(the day and both neighbours), a holiday change, a breach decision, or an
explicit request.

**Four steps, always in this order**, under the person's advisory lock:

```
refreshDayFacts(D−1, D, D+1)   shift snapshot · window_start · window_end · closingCap → close_due_at
re-attribute(D−1, D, D+1)      move only assignments that change; pinned ones stay (§8.4 step 9)
re-derive closures             every day whose events or closingCap changed (§8.4 step 10, §12.4)
recalculate(every record whose assigned events, closure or facts changed)
```

`refreshDayFacts` exists because those four values are **not** calculator
outputs any more — they steer attribution and auto-close. `closingCap` in
particular depends on the *next* day's shift, so changing Monday's start from
09:00 to 08:00 changes how long Sunday night may still be closed into, and
therefore when auto-close runs for it. One function computes all of them from
the day's shift and its neighbours, and it runs whenever any of these changes:
a shift assignment, an override, a rotation, a department default, a shift
version, a `shift_setting` row (day-start time or closing extension), or the
neighbouring day's shift. Day-open calls the same function when it materialises
a day, so a day's facts have one definition rather than two that drift. A moved
`closingCap` is also why closures are re-derived here: if Monday now starts at
08:00, an 08:30 punch can no longer be Sunday night's, and Sunday's ending has to
be decided again from what it has left.

- The queue job id is `recalc:{org}:{recordId}:{inputVersion}`. BullMQ drops a
  job whose id already exists, so duplicate triggers collapse (AT-I4). The
  version is in the id because a trigger that arrives *while* a job for the same
  day is running would otherwise be dropped, and the day would miss the newest
  input. With the version in the id, the newer trigger gets its own job, and an
  older job that finds `calculated_input_version >= input_version` exits
  without writing. A job that dead-letters is picked up again by the stale
  sweeper under the next generation (§5.4); after the third the record is
  flagged `recalculation-failed` — and while stale it already blocks a payroll
  snapshot.
- The job locks the record, loads the inputs, runs `calculate`, writes the
  result, increments `calculation_version`, sets `calculated_input_version`,
  updates the month summary, and — for a closed day inside a published payroll
  period — writes `attendance.day-changed` (AT-9).
- While a day is open its shift snapshot follows the resolver, so a shift
  assigned this morning applies today. Once closed, the snapshot changes only
  through an SH-6 past change.
- A sweeper every five minutes re-queues records that stayed stale for more
  than a minute, so a lost message cannot leave a day wrong.
- A stale record is shown as "recalculating", and payroll will not snapshot it
  (§14).

### 8.6 Day-open

At 00:05 organization time a job creates the record for every employee whose
employment covers the date: shift snapshot, placement snapshot, window, day
type, overlays, `close_due_at`. Leave and holiday days are already settled at
that point; working days wait for punches. It is an upsert, so running it twice
changes nothing, and a punch that arrives first creates the record itself.

Rows exist **only for dates inside the employment window** — nobody has an
attendance day before they joined or after they left. `not-employed` is the
status for the narrow case where employment changes after the fact (a joining
date corrected forward, say): those rows already exist and may hold events, so
they are marked rather than deleted.

**It works from a watermark, not a fixed lookback.** Each organization stores
the last date it has fully materialised (`attendance_day_open_state`); the job
walks forward from there to today, whatever the gap. A three-day catch-up would
leave holes after a longer outage, a late employee import or a missed schedule —
and a hole is not visible: payroll would read a missing day as no data rather
than as a day nobody judged (D3, D21). Two guards back it up: the job refuses to
advance the watermark past a date it could not complete, and payroll checks that
every employee has exactly the expected number of days for the period before it
snapshots (§14.4).

### 8.7 API

| Method | Path | Action | Notes |
|---|---|---|---|
| GET | `/api/attendance` | `attendance:view` | Stored records for a range, scope-filtered by the engine; over 92 days is 422 `ATTENDANCE_RANGE_TOO_LONG` pointing to export (AT-13) |
| GET | `/api/attendance/:userId/:date` | `attendance:view` | Day detail: record, effective and superseded events, corrections with actor and reason, shift source, leave, holiday, WFH (AT-12) |
| POST | `/api/attendance/export` | `attendance:export` | Background export to object storage, signed link (SE-6); correction reasons included (AT-7); audited (AT-14) |

- **Subject-keyed loader.** The router passes a loader only the one path
  parameter named by `resourceParam`, so the loader for
  `/api/attendance/:userId/:date` receives `userId` alone. It returns an
  `attendanceRecord` resource for that person —
  `{ type: 'attendanceRecord', id: userId, userId, departmentId, teamId, organizationId }` —
  which is what the scope check needs; the handler then reads the date. The
  same pattern serves `/api/leaves/balances/:userId` and
  `/api/breaks/policies/resolve/:userId`.
- The `attendanceRecord` policy mirrors `userPolicy`: `own` is
  `userId = principal`, `team` / `department` / `pool` / `all-people` follow the
  subject's placement.
- No attendance response carries a device serial or a PIN. Devices appear by
  name, for example "Main entrance (fingerprint)" (L9).

Screens: `/company/attendance/mine` and `/company/workforce/attendance`
(daily, weekly, monthly, day detail). They display what the API returns and
compute nothing (L17).

**Done when** a fixture month HR has prepared produces exactly the stored
records in the expected table HR signed off, and replaying any day — including
after voiding and restoring a punch — gives identical output.

---

## 9. Step 4 — Punching and the live board (`live-status`)

**In plain words.** The `/today` screen lets an employee punch in, take and end
a break, and punch out. A small table always knows who is working, on break,
not in yet, or finished, so the board never scans history. Every punch, from
any source, updates that table in the same transaction.

**Blocked on G1.** The registry has no action for an employee to punch
(`live-status` has no actions at all — README question 3), so the punch route
cannot be registered until the document owners add one.

### 9.1 The state machine, as data (LS-1, SM-3)

**It is declared once, in `packages/contracts/src/presence.ts`** (§5.3), and
imported by both `attendance` and `live-status`. It is shown here because this
is where it is easiest to read, not because `live-status` owns it — two modules
need the same answer, and a state machine with two copies is two state
machines.

```ts
export const PRESENCE = {
  NOT_IN:   { in: 'WORKING', scan: 'WORKING' },
  WORKING:  { 'break-start': 'ON_BREAK', scan: 'WORKING', out: 'FINISHED', 'auto-out': 'FINISHED' },
  ON_BREAK: { 'break-end': 'WORKING', scan: 'WORKING', out: 'FINISHED', 'auto-out': 'FINISHED' },
  FINISHED: {},                    // nothing reopens a finished day; later scans are kept and flagged
} as const;
```

`replay` and `departureOf` are two views of one reading, `readDay` (§5.3), over
the day's eligible events in one order, so `FINISHED` is reached exactly at the
departure: the board and the calculator cannot disagree about when a day ended,
not even when two events share a second. An event outside the window is kept and
flagged; a scan outside it still updates the row's last-seen fields, so the
board can say "seen 05:30, outside the shift window" without claiming the person
has started.

A web request for a move the table does not allow gets 422
`STATUS_TRANSITION_NOT_ALLOWED`, naming the current state and the allowed
moves (WF-4) — raised by `attendance` at §8.4 step 7, against the day
attribution resolved, from this same table. That includes an `out` in the same
second as the day's arrival, which the order of §5.3 would not read as a
departure. A device scan is a fact, so it is
never refused; if it does not fit the table it is stored and flagged.

**What a device scan means depends on the reader, and the device has to say
so.** A scan is evidence that someone was at a reader — on its own it does not
say whether they arrived or left. Every device declares a direction, and a
device whose payload identifies which reader produced the punch can declare one
per reader (§10.4):

| `reader_direction` | Scan becomes | Evidence | Board behaviour |
|---|---|---|---|
| `entry` | an `in` event | confirmed | Arrival, confirmed |
| `exit` | an `out` event | confirmed | The day finishes at the scan, like an explicit punch-out |
| `both-trusted` | the device's in/out key, mapped; a key the map does not know stays a `scan` | confirmed; a `scan` is assumed | Whatever the key says, and `trust_status_keys` must be on |
| `alternating` | `in`, `out`, `in`, … per day, opt-in | assumed | For a single terminal where staff do scan both ways; guarded (below) |
| `undirected` (default) | a `scan` event | assumed | The **first** scan opens the day; later scans do not claim a state |

The evidence is written on the event when it is recorded
(`attendance_event.evidence`, D29), from the reading the raw punch was given the
moment it arrived: its reader key, the direction that reader had then, and what
the punch meant (`biometric_punch.reader_key`, `direction_at_receipt`,
`meaning`, §10.3 step 3). Changing a device's direction changes how the punches
that arrive *after* the change are read, never how earlier ones were — not even
a punch still waiting as `held` or `unmapped`, which is replayed with the
reading it arrived with (D37). A punch the device made before the change but had
not yet sent is read the new way when it arrives, just as a new clock offset
applies to it (§10.6), so the screen that changes a direction shows when the
device was last heard from.

With a single undirected reader — the common Indian office setup, one terminal
at the door, and what Tapvera runs today — a person who scans on the way out
would otherwise sit on the board as `WORKING` for hours until auto-close
(TapCRM behaved exactly like this). So the projection carries two extra
fields: `presence_confidence` of `confirmed` or `assumed`, and `last_scan_at`.
After the first scan the person is `WORKING · confirmed`; after a later
undirected scan they are `WORKING · assumed, last seen 18:05 at Main gate`, and
the board shows that plainly instead of asserting they are still at work. The
day still closes by an explicit punch-out or by auto-close, which books the
last scan as the departure (LS-6, §12.3) — the honest reading of the evidence.

**Why a night shift needs this most.** With one undirected terminal, someone
who scans out at 05:04 stays `WORKING` until auto-close at 09:00 — a board that
says half the night staff are at work all morning. So two things help:
configuring a second reader as `exit` (or `both-trusted` where staff reliably
press in/out) upgrades the board to `confirmed` throughout; and where the last
eligible scan falls at or after the shift end, the row's `likely_finished_at`
is set, which **takes the person out of the working count** and into a
"possibly finished" group showing `likely left 05:04 · unconfirmed` (§9.3).
Changing only the label would leave the counts wrong for hours, which is the
thing a live board exists to get right. The stored `state` stays `WORKING`,
because LS-1 fixes the state machine; what changes is what counts as evidence
of someone being at work.

**`alternating` is available but opt-in, and never the default.** It reads the
first scan of the day as in, the next as out, and so on. That is fragile in
exactly the ways TapCRM showed — a double scan at the door, a missed scan on the
way out, a colleague holding the door — so it comes with guards: a scan within
60 seconds of the previous one is a duplicate (§10.3 step 7), so it does not
flip the direction, a flip that would produce a session under a configured
minimum is ignored and flagged, and every event it produces carries
`evidence = 'assumed'` — so the board shows it as assumed, and overtime resting
on one of its `out`s waits for review (§8.2). It suits a site whose people
genuinely scan both ways; it is not a substitute for an exit reader. And because
a day ends at its first `out` (D31), it suits only a site where people scan once
in and once out: where they also step out for lunch, the default `undirected`
mode is the right one, since its last scan becomes the departure. It is also the
one reading that depends on arrival order: a scan is alternated when it is
applied, from the scans of the same reader that arrived as `alternating` and
were applied before it, so one delivered after later scans from the same reader
is read out of turn. It is applied — evidence is
never dropped — and flagged `alternation-out-of-order` with a review item, and
the delivery-order property (§20) is stated for every other direction. A
terminal pushes its own log in order (§10.5), so this is the outage corner, not
the daily path.

Whichever mode a device is in, the registry screen says so, and the day detail
shows which reader produced each event.

**One door or two.** A classic attendance terminal — the Identix among them —
reports a PIN and a time and nothing that identifies a reader, so its direction
is a property of the device. An access controller with an entry door and an exit
door does identify the reader (`eventaddr` in ZK's realtime log, `doorNo` in
Hikvision's events, the device or door id in vendor APIs), and those punches
carry that key through to `NormalizedPunch.readerKey`. A device may therefore
have rows in `biometric_reader`, one per key, each with its own direction; the
device-level direction is what applies when a punch carries no key, or a key
with no row of its own. Without that, a controller with Door 1 in and Door 2 out
simply could not be described.
Its readers are one device, which is why the duplicate rule compares what two
punches mean, not only which device sent them (§10.3 step 7). An `exit` reader
ends the day at its first scan, like a punch-out (D31); at a site where people
also step out through that turnstile during the day, reading it as `undirected`
keeps the day open and lets its last scan become the departure (§12.3).

### 9.2 The punch route (proposed — G1)

`POST /api/status/punch` with `{ kind, clientEventId, clientTime?, location? }`:

1. **Validate the request shape.**
2. **Idempotency, before anything else** (TX-7). A `clientEventId` already
   recorded for this person returns that first result unchanged — but only when
   the request matches: the stored event carries a hash of the punch's meaning
   (kind, and the client time if one was sent). Same key, same hash → the
   original response. Same key, **different** hash → 409
   `IDEMPOTENCY_KEY_REUSED`, because that is a client bug, and answering "yes,
   done" to an `out` that was recorded as an `in` hides it. This has to come
   before the state check — which now sits inside the lock, at §8.4 step 7 —
   because a retried `in` would otherwise meet the `WORKING` state its own
   first attempt created and get a 422 where the client is owed a success. The
   unique index on `(organization_id, user_id, client_event_id)` makes the
   check exact under concurrent retries, and `appendEvent` repeats the same
   check under the lock (§8.4 steps 1 and 3); this one is only the cheap
   filter in front of it.
3. **Time.** `occurred_at` is the server's receipt time, to the whole second
   (T-6), always. A `clientTime` from an offline-queued punch (NF-19) is stored
   next to it as evidence. If the two differ by more than the tolerance
   (`attendance_setting`, 15 minutes by default) the day gets a review item
   carrying the claimed time, which a reviewer applies as an ordinary correction
   if it is genuine (D13). Nothing a client sends ever becomes an attendance
   instant on its own.
4. **Hand the punch to `AttendanceFacade.appendEvent`** and stop there. The
   route does not load a record, does not ask which day the caller is in, and
   does not check the move. All of that happens inside the person's advisory
   lock, after attribution has decided which day the punch belongs to, at
   §8.4 step 7.
5. Respond with the resolved record, the new state and — when a break policy
   exists — the remaining break allowance (BM-11). The response names the work
   date it resolved, so a client that punched in at 06:30 can show "Monday",
   not "Sunday".

**Why the route is this thin.** Every interesting rule here depends on *which
day* the punch belongs to, and the route cannot know that: attribution needs
the person's shifts, their open sessions and the event kind, and it needs to
run under the lock so two punches cannot both read the same history. A route
that resolved the day itself would be a second, weaker copy of `currentDayFor`,
running outside the lock, whose answer the append step would then quietly
overrule — the 06:30 punch-in refused against Sunday while attribution files it
on Monday. One answer, one place, one lock.

**A night that was never closed does not block the morning** (D30). When the
caller's previous session is still open and the next shift's opening window has
begun, `/today` offers two moves, not one: **Start this morning's shift** (`in`,
which §5.2's rules 1 and 2 file on the new day) and **End last night's shift now**
(`out`, which rule 3 files on the night). The screen leads with the first and
says what it means: last night's departure goes to HR as unconfirmed, and a
correction can be requested with the real time. Without the choice, the only
button would be "Punch out" — a confirmed departure at 08:50 that turns a
forgotten punch into hours of recorded overtime.

**The rules step 7 applies to an `in`** (D10) — each can only refuse or
annotate, never skip the next, and each is evaluated against the **resolved**
work date, not today's calendar date:

1. **Approved WFH on that work date** → allowed from anywhere, no geofence, no
   location requested, none stored (WFH-2, ID-18b).
2. **Arrival policy** `device` and no WFH → refused, 422
   `ARRIVAL_MUST_USE_DEVICE`, naming the terminal to use. Passing a geofence is
   not a way around this: ID-15c says location is a friction control, not an
   attendance control, so the policy is checked *before* the fence. An HR
   exception — an `arrival_exception` row, a dated, audited allowance for one
   person on one day — is the only other way through.
3. **Arrival policy** `device-or-web` (the PRD default) → the PRD's WFH-6
   behaviour: a geofenced employee is evaluated by
   `GeofenceFacade.evaluatePunch` with the browser location, on the same rules
   as login (ID-16), and a denial refuses the punch; a non-geofenced employee
   is accepted, marked `remote`, and the day is flagged *worked remotely
   without an approved request* for the review queue.
4. ID-13 fences the login while WFH-2 and WFH-6 talk about the punch, so this
   design evaluates at both points with the identity module's existing rules —
   otherwise a session that started at the office could open a day from
   anywhere.

Breaks and `out` skip the geofence: refusing to let someone end their day
because their phone lost GPS would only push the correction to HR. The
policies themselves are dated rows, so an `in` attributed to Sunday is judged
by Sunday's policy even when it arrives on Monday morning: the
`arrival_policy_override` for the department in that day's placement snapshot,
else the organization's `attendance_setting` in force on that date (§8.1).

There is no "HR punch on behalf" route. HR changes a day only through
corrections (§12), with a reason and a second person (L1, L18).

### 9.3 The projection

```sql
CREATE TABLE user_status (
  organization_id         uuid NOT NULL REFERENCES organization(id),
  user_id                 uuid NOT NULL,
  work_date               date NOT NULL,
  state                   text NOT NULL CHECK (state IN ('NOT_IN', 'WORKING', 'ON_BREAK', 'FINISHED')),
  since                   timestamptz,
  last_event_at           timestamptz,
  worked_minutes          integer NOT NULL DEFAULT 0,   -- as of the last event
  break_minutes           integer NOT NULL DEFAULT 0,
  presence_confidence     text NOT NULL DEFAULT 'confirmed'
                            CHECK (presence_confidence IN ('confirmed', 'assumed')),   -- §9.1
  last_scan_at            timestamptz,
  last_scan_device        text,
  likely_finished_at      timestamptz,                  -- §9.1: the instant this row stops counting as working
  is_wfh                  boolean NOT NULL DEFAULT false,
  day_group               text CHECK (day_group IN ('leave', 'holiday')),   -- LS-4
  shift_start_at          timestamptz,                  -- LS-3
  shift_end_at            timestamptz,
  window_start            timestamptz NOT NULL,         -- the day this row describes (§5.2)
  window_end              timestamptz NOT NULL,
  rollover_due_at         timestamptz NOT NULL,         -- when this row stops being current:
                                                        -- window_end normally, closingCap while an
                                                        -- extended session is still open
  grace_minutes           integer,
  flexible_target_minutes integer,                      -- LS-7
  updated_at              timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);
CREATE INDEX ix_user_status_rollover ON user_status (organization_id, rollover_due_at);
```

| Rule | How |
|---|---|
| LS-2 | Counts are one indexed query on this table |
| LS-3 | `NOT_IN` before `shift_start_at + grace` is "not yet due", not absent |
| LS-4 | `day_group` is set by day-open from the day's overlays and calendar |
| LS-5 | Break minutes against the resolved break policy; the board highlights, a person decides |
| LS-6 | `FINISHED` from `out` or auto-close; auto-closed days go to the review queue |
| LS-7 | Flexible staff show worked minutes against the target instead of lateness |
| LS-8 | `status:changed` socket events after commit; polling only after repeated socket failure |
| LS-9 | No write route on the board |
| LS-10 | The client formats every time in the organization timezone |

A person's **current day is whatever `currentDayFor` answers**, not today's
calendar date and not the window alone — at 02:00 a night worker is still on
yesterday's date (§6.6), at 07:30 they are still finishing it, and at 06:30
with a pulled-forward arrival they are already on the next one (§5.2).

**A person's day therefore rolls over at their own boundary, and something has
to move the row.** For a night worker on nights the boundary is 12:30; at 12:31
their current day is the new date, while the row still holds yesterday's
`work_date`, `shift_start_at` and `day_group` — the very fields LS-3 and LS-4
read. A midnight job does not help, because midnight is not their boundary. So:

- the row carries `rollover_due_at` — the instant it stops being current. That
  is `window_end` on an ordinary day, and `closingCap` while an extended
  session is still open, so a night that is legitimately running past 07:00
  does not read as stale every five minutes until 09:00. The projector rewrites
  it on every update, so a punch-out at 05:20 drops it straight back to
  `window_end`;
- a **rollover sweeper** every five minutes calls `refresh` for rows whose
  `rollover_due_at <= now()`, and writes the fresh baseline from the
  `attendance_record` day-open has already created (`NOT_IN`, nobody has
  punched yet);
- a read arriving before the sweeper resolves the person's day exactly the same
  way the sweeper does, so it can only ever agree with it.

**One function answers "which day is this person in", everywhere.**
`AttendanceFacade.currentDayFor(userId, at)` — the five-step rule in §5.2.
`PresenceProjector.refresh`, the rollover sweeper, the board's read path,
and `/today` all call it, and none of them calls `dayWindowContaining`
directly. The punch route is not in that list any more, and deliberately so:
it resolves no day at all (§9.2). Three code paths asking the same question three
slightly different ways is how a board comes to say a night worker has started
a new day while they are still finishing the old one — which is precisely what
happened between the sweeper and the read fallback in an earlier revision.

That is one cheap indexed sweep over at most one row per employee, and the
board never shows a night worker's finished shift as though it were today.

**Groups and counts, not just labels** (LS-2, LS-5). The four PRD states stay
exactly as LS-1 defines them, but a row that is `WORKING` on an assumed scan
after the shift ended is not evidence that someone is at work, so it must not
be counted as one. `likely_finished_at` is set to the shift end when the last
event is an assumed scan at or after it, and cleared by any event whose
evidence is `confirmed` (§8.1).
The board's groups are then one indexed query each:

```
working            state = 'WORKING'  AND (likely_finished_at IS NULL OR likely_finished_at > now())
possibly finished  state = 'WORKING'  AND  likely_finished_at <= now()      → shown with the last scan
on break           state = 'ON_BREAK'
finished           state = 'FINISHED'
not in             state = 'NOT_IN'   → split by shift_start_at + grace into "due" and "not yet due" (LS-3)
on leave / holiday day_group                                                                   (LS-4)
```

Auto-close later turns the "possibly finished" rows into real `FINISHED` days
with a flagged, assumed departure (§12.3). Until then the board says what it
knows and no more.

**The projector has two entry points, and both are keyed on the person, not on
a day** (D9). `apply(tx, userId, event)` is the fast path, and it is taken only
when all three of these hold:

```
1. the event is eligible, and in a later second than every effective event on its day
2. no correction, void or re-attribution is in play
3. user_status.work_date  ===  currentDayFor(userId, now)
```

Anything else calls `refresh` — including a punch that shares a second with
another event, which the order of §5.3 places, not its arrival. **The third
condition is the one that is easy to miss.** An event can move the person into a
new day by existing: the 06:30 punch-in resolves to Monday while the row still
describes Sunday. `apply` would then step Sunday's state machine — writing
Monday's arrival over a night that has not been closed yet, or refusing to move
at all because Sunday is `FINISHED`. Whenever the resolved day differs from the
day the row currently holds, the row is rebuilt from scratch instead, which also
writes the new day's `work_date`, `shift_start_at`, `window_start`, `window_end`
and `rollover_due_at` in one go. Put plainly: **`apply` advances a day,
`refresh` changes days.** `refresh(tx, userId, at)` — also what the rollover
sweeper calls — resolves the day through `currentDayFor(userId, at)`, never by
window alone, replays its effective events through the state machine and writes
the row. Corrections, device replays, backlog pushes, shift changes and
recalculation all use it. A change to a day that is neither the person's current
day nor the one their row still describes never writes here: attendance is
recalculated and the board stays as it is, which is the only safe answer,
because one row cannot describe two days. Both paths are the same function over
the same table, so there is one definition of "what state is this person in"
(NF-20).

### 9.4 API and screens

| Method | Path | Action | Notes |
|---|---|---|---|
| POST | `/api/status/punch` | *proposed* `status:punch` | **G1** |
| GET | `/api/attendance/live` | `attendance:view-live` | Board groups and counts, scope-filtered: HR sees everyone, a team lead their team, an employee at `own` only themselves — which is what `/today` shows |

`/today` reads the caller's own row from `/api/attendance/live`, together with
the moves available now: `allowedMoves` for the current day, plus `in` for the
next day while its opening window is open and the previous session is still
open (§9.2).

Screens: `/company/today` (punch and break widget, allowance) and
`/company/workforce/live`.

**Done when** web punching follows the arrival policy and WFH rules, a punch is
on a connected board within 3 seconds at 2,000 employees and 1,200 connections
(NF-2, load-tested), and a team lead's board holds exactly their team.

---

## 10. Step 5 — Biometric: one device layer for every brand

**In plain words.** Devices differ in how they deliver punches, not in what a
punch is. So there is one pipeline that takes a punch — PIN, time, device — and
turns it into an attendance event, and a small adapter per delivery method.
The first adapter speaks ZKTeco ADMS, the protocol the Identix terminal uses
today. Adding a brand later means adding an adapter, not a second attendance
path.

### 10.1 Delivery methods and brands

| Adapter | How punches arrive | Typical devices | Device authentication | Order |
|---|---|---|---|---|
| `zk-adms` | The device pushes plain text to `/iclock/*` | ZKTeco attendance terminals and their OEM brands — eSSL, and the eSSL **Identix** series in use today — fingerprint, face, card | Registered serial, IP allowlist, backfill limit | **First** |
| `zk-security-push` | Same paths, with registration and a per-device token | Newer ZKTeco face and access-control terminals | Registry code → token cookie on every request | When such a device is bought |
| `edge-agent` | A small program on an office PC polls LAN devices and forwards batches over HTTPS | Devices with no cloud push: ZK pull protocol (TCP 4370), Hikvision ISAPI on the LAN, Matrix COSEC device API | Connector credential + signed requests | On demand |
| `vendor-api` | The server polls the vendor's platform on a schedule | ZKBio Time / BioTime, Suprema BioStar 2, Anviz CrossChex Cloud, Hikvision HikCentral, Matrix COSEC server | The vendor's own login; secret in the secret store | On demand |
| `webhook` | A vendor or custom bridge posts to us | Any middleware that can send signed HTTP | HMAC signature per connector | On demand |
| `file-import` | HR uploads a CSV or XLSX export | Anything with export software — the universal fallback | Authenticated product user | With step 5 (needs G7) |

Vendor details, checked September 2026 — confirm against the vendor's current
document when building each adapter:

| Platform | Punches from | Login |
|---|---|---|
| ZKBio Time / BioTime | `GET /iclock/api/transactions/?start_time=…&end_time=…` → `emp_code`, `punch_time`, terminal | JWT (`Authorization: JWT …`) |
| Suprema BioStar 2 | `POST /api/events/search`, datetime between two UTC ISO-8601 values, limit ≤ 2,000; WebSocket for real time | `bs-session-id` header from login |
| Anviz CrossChex Cloud | JSON API, token from `authorize.token` with API key and secret | token |
| Hikvision | `POST /ISAPI/AccessControl/AcsEvent?format=json` with `AcsEventCond` (search id, position, max results, time range) → `employeeNoString`, `time`, `serialNo` | HTTP digest |
| ZK pull protocol | TCP 4370 — read logs, stream live logs, read the device clock (Node libraries exist, e.g. `zkteco-js`) | device comm key |

### 10.2 The adapter contract

```ts
/** What every adapter produces. The pipeline accepts nothing else. */
export interface NormalizedPunch {
  deviceId: string;             // biometric_device.id
  pin: string;                  // the person's number on the device / vendor
  deviceLocalTime: string | null;   // the device's own clock reading, e.g. '2026-09-22 09:02:11'
                                    // (no zone); with the reader, the re-send identity (§10.3)
  occurredAt: string;           // ISO instant, using the device's configured timezone
  statusCode: string | null;    // the device's in/out key — kept, not trusted by default
  statusKind: 'in' | 'out' | 'break-start' | 'break-end' | null;
                                // what that key says in the protocol's own map; null when
                                // it says nothing the map knows. Read only for a
                                // both-trusted reader, and then frozen as the punch's
                                // meaning when it arrives (§10.3 step 3)
  verifyMode: 'fingerprint' | 'face' | 'card' | 'password' | 'palm' | 'other' | null;
  readerKey: string | null;     // which reader fired, where the protocol says (§10.4)
  externalEventId: string | null;   // the source's own event id, where it has one: then the
                                    // whole re-send identity (§10.3)
  raw: string;                  // the original line or JSON fragment, never biometric data
}

export interface BiometricAdapter {
  readonly kind: AdapterKind;
  /** Pure: payload in, punches and rejected lines out. Tested with captured payloads. */
  parse(payload: unknown, device: DeviceConfig): { punches: NormalizedPunch[]; rejected: RejectedLine[] };
}

export interface PollingAdapter extends BiometricAdapter {
  poll(connector: ConnectorConfig, cursor: unknown): Promise<{ payload: unknown; nextCursor: unknown }>;
}
```

### 10.3 The pipeline (one implementation)

```
adapter → normalize → read once → store raw → plausibility → PIN → duplicate check → mode → apply → answer
```

1. **Authenticate the source** (per adapter, §10.5).
2. **Parse** into `NormalizedPunch[]`. Unparseable lines are logged with the
   line number; one bad line never costs the rest of the batch.
3. **Read the punch, once** (D37). How the punch is read is decided here, from
   the device's settings as it arrives, and stored with it in step 4 — never
   looked up again:
   - **the clock**: `occurred_at`, from the device's own reading and its
     timezone (step 2), and `corrected_at = occurred_at + device offset`, with
     the offset used (BI-4, L12);
   - **the direction**: the `biometric_reader` row for the punch's reader key
     when there is one, otherwise the device's `reader_direction` — stored as
     `direction_at_receipt`;
   - **the meaning**, before any alternation: `in` for an entry reader, `out`
     for an exit reader, the adapter's `statusKind` for a `both-trusted`
     reader — a plain `scan` when the key says nothing the map knows — and a
     plain `scan` for an `alternating` or `undirected` reader;
   - **the mode**: whether the device was in dry-run (BI-5).

   This comes before anything can hold, refuse or park the punch, so a punch
   that waits — `held` for a week, `unmapped` until HR adds the PIN — is read
   exactly as it was on the day it arrived. A change to a device's settings
   reaches only the punches that arrive after it.
4. **Store raw** in `biometric_punch`, the reading included, with one
   multi-row insert, `ON CONFLICT DO NOTHING`. A re-send is recognised by what
   the **source** sent, never by TapIt's reading of it: its own event id where
   it has one (`external_event_id` — vendor clouds, most access controllers),
   otherwise device, reader, PIN, the device's own clock reading and status key
   together. A re-send is a no-op and only counted, and the stored row keeps
   the reading its first arrival was given. Because the identity is the
   device's reading rather than the instant TapIt computed from it, correcting
   a device's timezone cannot turn its next full-log resend into a day of new
   punches, and two readers of one controller firing in the same second are
   two punches, not one. From here a punch is never lost (NF-8, BI-3).
5. **Plausibility**: more than 5 minutes in the future → `rejected` ("check the
   device clock"). Older than the device's backfill window (default 72 hours,
   Q7) → `held` until an administrator replays it, so a fabricated backdated
   push cannot open a paid day, and a device dumping a year of old logs after a
   reset does not rewrite history.
6. **PIN → person** on the punch's own date — the date of its corrected
   instant in the organization's timezone — through `biometric_pin_mapping`:
   the row for that exact device if there is one, otherwise the connector-wide
   row. No mapping → `unmapped`, kept and replayable (BI-3). Outside the
   person's employment window → `rejected`. The person is found before the
   duplicate check because a mapping is dated: one PIN can be Alice's until
   Sunday and Bob's from Monday, and only the mapping says whose punch it is.
7. **Duplicates (BI-6), by person and meaning.** Punches from the same device
   and PIN, **mapped to the same person, with the same meaning**, each within
   60 seconds of the one before, are one burst: its **earliest** punch goes on,
   and the rest are `duplicate`, linked to it (a tie in one second breaks on the
   reader key, then the source's own event id, then the raw line — never on
   TapIt's row id). Different meanings never collapse: a controller's entry
   reader at 09:00:20 and exit reader at 09:00:45 both apply, and what they mean
   for the day is the ordinary rule — an exit ends the day (D31), and anything
   after it goes to review. Different people never collapse either: Alice's
   scan at 23:59:40 on Sunday and Bob's at 00:00:20 on Monday, on the PIN that
   passed from her to him at midnight, are two punches on two people's days,
   and the database refuses a duplicate linked to another person's punch
   (§10.4). Dry-run punches form bursts only with each other, since a punch that
   writes nothing must never hide one that does. **The earliest wins whatever
   order punches arrive in.** When a late punch is earlier than a burst's head,
   or joins two bursts into one, the head that no longer comes first becomes
   `duplicate`, and the burst's other duplicates are re-linked to the new head.
   If the displaced head had been applied, its event — always the same
   person's — is retired in the same transaction, under that person's lock: by
   `appendEvent` beside the new head's event when the incoming punch is the new
   head, and by `AttendanceFacade.retireEvent` when it appends nothing — a punch
   that bridges two bursts is itself a duplicate (§8.4). An event a person's
   correction has already superseded is left alone, with a review item. One
   incoming punch displaces at most one applied punch: the head of the burst it
   joins, or the head of the later of the two bursts it bridges. Only punches
   with a person take part: those `held`, `rejected` or `unmapped` join a burst
   when they are replayed, with the person their mapping gives them then. The
   whole check runs under a transaction-scoped advisory lock on the
   organization, device and PIN, held until the punch is applied, so two
   punches of one burst processed at once — a live push beside a backlog job —
   cannot both become its head.
8. **Mode** (BI-5), for a punch that arrived while its device was in dry-run:
   if it leads its burst — the earliest punch, or the only one — it becomes
   `dry-run`; if step 7 made it a `duplicate`, it stays `duplicate`, linked to
   the punch that leads, as the key on `duplicate_of` requires (§10.4). Either
   way it is logged and never creates an attendance event, however late it is
   replayed.
9. **Apply**: `AttendanceFacade.appendEvent` with the kind the stored reading
   gives — the meaning, or for a punch that arrived as `alternating`, the
   alternated kind (§9.1) — and the evidence that reading implies: `confirmed`
   for an `in`, `out` or break from an entry, exit or both-trusted reader,
   `assumed` for a scan or an alternated kind. The punch becomes `applied`,
   linked to the event. One short transaction per punch. A punch a device held
   through an outage runs this same path, so it lands on the day it would have
   landed on had it arrived on time, and that day's closure is re-derived
   (§12.4) — the backlog case is not a special case. A punch replayed from
   `held` or `unmapped` runs it too, with the reading it arrived with, whatever
   the device's settings say today.
10. **Answer** the device in its own protocol.

Small pushes (a realtime push is one line) are processed before answering, so
the board updates at once. Large backlogs are answered as soon as step 4
commits and processed by a queue.

### 10.4 Tables

```sql
CREATE TABLE biometric_connector (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id       uuid NOT NULL REFERENCES organization(id),
  kind                  text NOT NULL CHECK (kind IN ('zk-adms', 'zk-security-push', 'edge-agent',
                                                      'vendor-api', 'webhook', 'file-import')),
  vendor                text,                    -- 'zkteco', 'essl', 'suprema', 'hikvision', …
  name                  text NOT NULL,
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  credential_hash       text,                    -- edge-agent, webhook: a hash, never the secret
  credential_expires_at timestamptz,
  integration_key       text,                    -- vendor-api: the secret lives in the secret store (SE-10)
  ip_allowlist          inet[],
  poll_cursor           jsonb,                   -- vendor-api position
  config                jsonb NOT NULL DEFAULT '{}',
  last_success_at       timestamptz,
  last_error            text,
  created_by            uuid NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)                   -- the target of the composite keys below
);

CREATE TABLE biometric_device (
  id                   uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id      uuid NOT NULL REFERENCES organization(id),
  connector_id         uuid NOT NULL,
  serial_number        text NOT NULL,
  name                 text NOT NULL,
  location_label       text,
  status               text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'enabled', 'disabled')),
  dry_run              boolean NOT NULL DEFAULT true,          -- BI-5: every device starts here
  timezone             text NOT NULL,                          -- IANA; defaults to the organization's
  handshake_timezone   text NOT NULL DEFAULT 'derive',         -- 'derive' | 'omit' | an explicit value
  clock_offset_seconds integer NOT NULL DEFAULT 0,             -- BI-4, applied at ingest
  reader_direction     text NOT NULL DEFAULT 'undirected'
                         CHECK (reader_direction IN ('entry', 'exit', 'both-trusted',
                                                     'alternating', 'undirected')),
  trust_status_keys    boolean NOT NULL DEFAULT false,   -- required by 'both-trusted'
  ip_allowlist         inet[],
  backfill_hours       integer NOT NULL DEFAULT 72,
  stamp_mode           text NOT NULL DEFAULT 'resend-all' CHECK (stamp_mode IN ('resend-all', 'resume')),
  registry_code        text,                                   -- zk-security-push only
  firmware             text,
  push_version         text,
  last_seen_at         timestamptz,
  last_push_at         timestamptz,
  last_skew_seconds    integer,
  last_skew_at         timestamptz,
  UNIQUE (organization_id, serial_number),
  UNIQUE (organization_id, id)
);

-- Global, like identity_email_directory (0024): finds the tenant before a context exists.
CREATE TABLE biometric_device_directory (
  serial_number   text PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organization(id),
  device_id       uuid NOT NULL,
  FOREIGN KEY (organization_id, device_id) REFERENCES biometric_device (organization_id, id)
);                                            -- kept in sync by trigger; review per TN-3

-- BI-2, scoped as G15 asks the owners to confirm: within its scope, a PIN belongs to
-- one person at a time. The scope is a connector, optionally narrowed to one device —
-- because "PIN 1001" means one thing on a ZK fleet that shares an enrolment list and
-- something else entirely on a Hikvision terminal or a vendor cloud, and one person
-- legitimately has different numbers on different systems.
CREATE TABLE biometric_pin_mapping (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  connector_id    uuid NOT NULL,
  device_id       uuid,                    -- NULL: every device on that connector
  pin             text NOT NULL,
  user_id         uuid NOT NULL,
  effective_from  date NOT NULL,
  effective_to    date,
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- One holder per PIN per scope and period. The sentinel puts `device_id` in the key;
  -- it does NOT stop a connector-wide row and a device row from existing for the same
  -- PIN, and that is deliberate: a device row OVERRIDES the connector row for that
  -- device (the lookup order in §10.3 step 6). Where the two point at different people
  -- the registry shows it as a warning, since it is usually a mistake rather than a
  -- deliberate override.
  EXCLUDE USING gist (organization_id WITH =, connector_id WITH =,
                      coalesce(device_id, '00000000-0000-0000-0000-000000000000'::uuid) WITH =,
                      pin WITH =, daterange(effective_from, effective_to, '[)') WITH &&),
  FOREIGN KEY (organization_id, connector_id) REFERENCES biometric_connector (organization_id, id),
  FOREIGN KEY (organization_id, device_id)    REFERENCES biometric_device    (organization_id, id),
  FOREIGN KEY (organization_id, user_id)      REFERENCES app_user            (organization_id, id)
);
CREATE INDEX ix_pin_mapping_user ON biometric_pin_mapping (organization_id, user_id);

CREATE TABLE biometric_punch (                 -- raw punches; kept 7 years with attendance (DP-6)
  id                     uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id        uuid NOT NULL REFERENCES organization(id),
  device_id              uuid NOT NULL,
  pin                    text NOT NULL,
  device_local_time      timestamp,              -- the device's own clock reading, no zone;
                                                  -- NULL when a source sends only an instant
  occurred_at            timestamptz NOT NULL,
  corrected_at           timestamptz NOT NULL,
  applied_offset_seconds integer NOT NULL,
  received_at            timestamptz NOT NULL DEFAULT now(),
  status_code            text,
  verify_mode            text,
  reader_key             text,                   -- which reader fired, where the protocol says (§9.1)
  external_event_id      text,                   -- the source's own event id, where it has one
  raw_line               text NOT NULL,
  -- The reading, taken once when the punch first arrives and never looked up again (D37,
  -- §10.3 step 3): with corrected_at and applied_offset_seconds above, the direction its
  -- reader had, what it meant before any alternation, and whether the device was in
  -- dry-run. A held or unmapped punch replayed next month is read exactly this way.
  direction_at_receipt   text NOT NULL CHECK (direction_at_receipt IN ('entry', 'exit', 'both-trusted',
                                                                       'alternating', 'undirected')),
  meaning                text NOT NULL CHECK (meaning IN ('in', 'out', 'break-start', 'break-end', 'scan')),
  dry_run_at_receipt     boolean NOT NULL,
  status                 text NOT NULL CHECK (status IN ('received', 'applied', 'duplicate', 'unmapped',
                                                         'dry-run', 'rejected', 'held')),
  status_reason          text,
  duplicate_of           uuid,                   -- the earliest punch of its burst: same person
  user_id                uuid,
  attendance_event_id    uuid,
  replay_count           integer NOT NULL DEFAULT 0,
  processed_at           timestamptz,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, user_id, id),         -- the target of attendance_event.biometric_punch_id
                                                  -- and of duplicate_of
  -- A burst is one person's (D33, D34): a duplicate names the same person as its head.
  FOREIGN KEY (organization_id, user_id, duplicate_of)
    REFERENCES biometric_punch (organization_id, user_id, id),
  -- The event a punch became belongs to the person the punch was mapped to (D34).
  FOREIGN KEY (organization_id, user_id, attendance_event_id)
    REFERENCES attendance_event (organization_id, user_id, id),
  CHECK ((status = 'duplicate') = (duplicate_of IS NOT NULL)),
  CHECK (duplicate_of IS NULL OR duplicate_of <> id),
  -- A key with a NULL in it is not checked at all (MATCH SIMPLE), so a punch that points
  -- at an event, or at the head of its burst, must name its person.
  CHECK (attendance_event_id IS NULL OR user_id IS NOT NULL),
  CHECK (duplicate_of IS NULL OR user_id IS NOT NULL),
  CHECK (status <> 'applied' OR attendance_event_id IS NOT NULL),
  -- The reading agrees with itself: an entry reader means `in`, an exit reader `out`, and
  -- an alternating or undirected reader a plain scan until it is applied.
  CHECK (direction_at_receipt <> 'entry' OR meaning = 'in'),
  CHECK (direction_at_receipt <> 'exit' OR meaning = 'out'),
  CHECK (direction_at_receipt NOT IN ('alternating', 'undirected') OR meaning = 'scan'),
  -- BI-5: a punch that arrived in dry-run never becomes attendance, however late it is
  -- replayed, and only such a punch is marked dry-run.
  CHECK (NOT dry_run_at_receipt OR attendance_event_id IS NULL),
  CHECK (status <> 'dry-run' OR dry_run_at_receipt)
);
-- A re-send is recognised by what the SOURCE sent (§10.3 step 4): its own event id where it
-- has one, otherwise device, reader, PIN, the device's clock reading and status key. The
-- insert's ON CONFLICT DO NOTHING covers all three indexes, so a re-send keeps the reading
-- its first arrival was given.
CREATE UNIQUE INDEX ux_biometric_punch_external
  ON biometric_punch (organization_id, device_id, external_event_id) WHERE external_event_id IS NOT NULL;
CREATE UNIQUE INDEX ux_biometric_punch_resend
  ON biometric_punch (organization_id, device_id, coalesce(reader_key, ''), pin, device_local_time,
                      coalesce(status_code, ''))
  WHERE external_event_id IS NULL AND device_local_time IS NOT NULL;
CREATE UNIQUE INDEX ux_biometric_punch_resend_instant          -- sources that send only an instant
  ON biometric_punch (organization_id, device_id, coalesce(reader_key, ''), pin, occurred_at,
                      coalesce(status_code, ''))
  WHERE external_event_id IS NULL AND device_local_time IS NULL;
-- The duplicate check's neighbours (§10.3 step 7): same device, PIN, person, mode and
-- meaning, by corrected time. Only punches with a person take part.
CREATE INDEX ix_biometric_punch_burst
  ON biometric_punch (organization_id, device_id, pin, user_id, dry_run_at_receipt, meaning, corrected_at)
  WHERE status IN ('applied', 'duplicate', 'dry-run');
CREATE INDEX ix_biometric_punch_stream   ON biometric_punch (organization_id, received_at DESC);
CREATE INDEX ix_biometric_punch_unmapped ON biometric_punch (organization_id, pin, occurred_at)
  WHERE status = 'unmapped';
-- A trigger refuses changes to the raw columns and to the reading — reader_key,
-- corrected_at, applied_offset_seconds, direction_at_receipt, meaning and
-- dry_run_at_receipt among them; only the processing fields move. user_id cannot change
-- once an event points at the punch, or once the punch is linked into its burst: the keys
-- refuse it.

-- Step 5 adds the key attendance_event.biometric_punch_id has waited for since step 3
-- (§8.1): a device event belongs to the person its punch was mapped to (D34).
ALTER TABLE attendance_event
  ADD FOREIGN KEY (organization_id, user_id, biometric_punch_id)
      REFERENCES biometric_punch (organization_id, user_id, id);
```

```sql
-- Only for devices whose punches identify which reader fired. A terminal that reports
-- nothing but PIN and time has no rows here and uses biometric_device.reader_direction.
-- Either is read into each punch as it arrives (§10.3 step 3), so changing a direction
-- reaches only the punches that arrive after it (D37).
CREATE TABLE biometric_reader (
  organization_id  uuid NOT NULL,
  device_id        uuid NOT NULL,
  reader_key       text NOT NULL,      -- as the payload spells it: eventaddr, doorNo, …
  label            text NOT NULL,      -- "Main entrance", "Exit turnstile"
  direction        text NOT NULL CHECK (direction IN ('entry', 'exit', 'both-trusted',
                                                      'alternating', 'undirected')),
  PRIMARY KEY (organization_id, device_id, reader_key),
  FOREIGN KEY (organization_id, device_id) REFERENCES biometric_device (organization_id, id)
);
```

`NormalizedPunch.readerKey` is filled by every adapter whose protocol carries
one, and `biometric_punch.reader_key` stores it beside the raw line, with
`direction_at_receipt` and `meaning` recording how the punch was read when it
arrived — so the day detail can say which door a person used and what the punch
was taken to mean, and a replay never consults today's settings.

Plus `biometric_alert` (device, kind — `silent`, `skew`, `timezone-suspect`,
`biometric-data-received`, `new-source-ip` — opened, resolved) and, later,
`biometric_device_command` for commands to devices (G7).

### 10.5 The ZKTeco ADMS adapter — the Identix in use today

The old TapCRM's receiver (`routes/iclockRoutes.js`,
`services/biometric/AdmsParser.js`) talks to this device today, and most of its
protocol handling is right. TapIt keeps those behaviours as requirements —
written afresh, not copied — and fixes the security and privacy gaps.

**Endpoints** — the paths are fixed by the firmware:

| Request | Meaning | Answer |
|---|---|---|
| `GET /iclock/cdata?SN=…&options=all&pushver=…` | Handshake at boot and periodically | Plain-text options block (below) |
| `POST /iclock/cdata?SN=…&table=ATTLOG&Stamp=…` | Attendance lines | `OK: <count>` |
| `POST /iclock/cdata?SN=…&table=OPERLOG` | Operation log | `OK` — keep `OPLOG` lines as device events; discard user, fingerprint, face and photo lines unread |
| `POST /iclock/cdata?table=ATTPHOTO` and other tables | Photos, errors | `OK`, discarded unread |
| `GET /iclock/getrequest?SN=…` | "Any commands for me?" every `Delay` seconds | `OK`, or a queued command `C:<id>:<command>` |
| `POST /iclock/devicecmd?SN=…` | Command results, `ID=…&Return=…&CMD=…` | `OK` |
| `/iclock/ping`, `/registry`, `/push`, `/fdata`, `/querydata`, `/edata`, anything else under `/iclock` | Firmware housekeeping | `OK` |

**Kept from the old TapCRM, because each one is a known silent failure:**

- Accept `.aspx` suffixes in any letter case (`/iclock/cdata.aspx`), which older
  eSSL and Identix firmware sends.
- Parse the body as plain text whatever the `Content-Type`, up to 5 MB.
- Always answer `200` with plain text — never JSON, never 4xx or 5xx, even on an
  internal error. A non-200 makes the device resend the same batch before
  anything new, so one bad line blocks all later punches. Errors are logged and
  visible on the device page instead.
- **But 200 is not the same as "accepted", and the two must not drift apart.**
  The invariant: *nothing tells the device a line is safely taken until that
  line's raw row has committed*. So the `OK: <count>` body counts only rows
  whose insert committed, a failure answers a bare `OK` and counts nothing, and
  — this is the one that actually matters — the stored `Stamp` advances only
  after that commit. With `stamp_mode = 'resend-all'` (the default, and what
  the Identix runs) the device resends its log anyway, so a lost push comes
  back by itself; with `resume` the unadvanced stamp is what brings it back.
  Get this backwards and a crash between "answered OK" and "stored the rows"
  loses a day's punches silently.
- Tolerant line parsing: tabs, runs of spaces, single spaces, CRLF, extra
  columns.
- `TimeZone` in the handshake is in **minutes** for fractional zones (`330` for
  IST) and in hours for whole-hour zones; `omit` is available per device for
  firmware that mangles it. The value rebases the device clock, which is why a
  wrong spelling shifted every punch (L11).
- `Realtime=1` so each punch is pushed within seconds; `Delay=60` for the
  command poll.
- Keep the device's in/out key but do not trust it by default; arrival and
  departure come from the order of scans.

**Changed from the old TapCRM:**

| Old TapCRM | TapIt |
|---|---|
| `TransFlag` asked for `AttPhoto EnrollUser ChgUser EnrollFP ChgFP UserPic` — fingerprint templates and photos | `TransFlag=TransData AttLog OpLog`. Firmware that takes the 12-flag form gets only the attendance-log and operation-log flags, bit positions confirmed against that firmware's document. Any template or photo line that still arrives is discarded unread and raises `biometric-data-received` (DP-2, L10) |
| Serial was the only gate in production | Serial + per-device IP allowlist + backfill window + future-time check + rate limit per serial and per IP |
| Unknown serials auto-registered by default | Never. Unknown serials are logged and counted; an administrator registers a device, which starts `pending` and in dry-run |
| Serial and PIN returned in employees' own attendance data | Never returned by attendance APIs |
| Offset applied to arrivals only | Offset applied once at ingest to everything |
| 7-day backfill | 72 hours by default (Q7); older lines are `held` |
| Env variables for timezone, offset, secret | Per-device settings, audited |

**The handshake answer:**

```
GET OPTION FROM: <serial>
ATTLOGStamp=None
OPERLOGStamp=9999
ATTPHOTOStamp=None
ErrorDelay=30
Delay=60
TransTimes=00:00;14:05
TransInterval=1
TransFlag=TransData AttLog OpLog
TimeZone=330
Realtime=1
Encrypt=0
```

`ATTLOGStamp=None` makes the device resend its whole log at each handshake,
which TapCRM chose on purpose: the unique index makes resends free, and "twice"
is better than "never". Each device can switch to `stamp_mode = 'resume'` —
return the last stored `Stamp` so only newer lines come — once it has been
stable for a while.

**Clock.** ZKTeco's push specification states that the server's HTTP `Date`
header is what the device synchronises its clock to, and the `TimeZone` value
then gives local time — which matches what TapCRM saw when a wrong `TimeZone`
silently undid a hand-corrected clock. So the API host must be
NTP-synchronised, and the reverse proxy must not strip `Date` on `/iclock`.
Commissioning confirms it on the device itself (§10.9 step 5).

**How a request finds its tenant.** Device requests carry no user token, so
they are served by a separate machine surface mounted before
`requestContext`, like `/api/platform` and the public identity routes (G2):

```
/iclock/* request
  1. normalise path, read SN
  2. biometric_device_directory: SN → organization, device       (bootstrap read, no tenant yet)
     unknown SN → log, count, answer OK
  3. createRequestContext with a service principal for that device (no actions), RLS on
  4. device pending or disabled, or IP not allowed → log, answer OK, store nothing (BI-1)
  5. handshake → options block;  ATTLOG → pipeline (§10.3);  poll → OK or a command
```

The device principal follows the audit drainer's system principal: account
type `service`, no allowed actions, so it can reach the ingest service and no
product route.

**Newer ZK firmware (Security PUSH).** These devices first call
`POST /iclock/registry`; the server answers `RegistryCode=<random>` only for a
registered, enabled serial. Later requests carry
`Cookie: token=<MD5 of RegistryCode, serial and SessionID>`, which the adapter
checks on every request. That gives real per-device authentication where the
firmware supports it.

**Be honest about the legacy path.** The Identix's attendance firmware has no
token and, on many builds, no TLS. Serial plus source IP is then the whole
trust boundary, and a serial is not a secret — it is printed on the device and
known to anyone who has seen a punch record. Anyone who can originate traffic
from an allowed address can post attendance for any PIN. So, in order of
preference:

1. **Do not expose the legacy endpoint to the internet.** Run the ingest inside
   the office network — the edge agent, a site-to-site tunnel, or a reverse
   proxy on the LAN that forwards to the cloud over TLS with a client
   certificate. The device then talks only to something on its own network, and
   the internet only ever sees an authenticated connection.
2. If it must be public: TLS wherever the firmware allows it, a tight IP
   allowlist, rate limits per serial and per address, and the anomaly alerts
   below (a new source address for a known serial, a burst of PINs, backdated
   lines).
3. Record what is left as a known residual risk, with the backfill window
   (§10.3 step 5) and the review queue as the compensating controls: forged
   punches land as reviewable days, not as silently paid ones.

Option 1 is the recommendation for Tapvera, since the office already has the
machine an edge agent would run on.

### 10.6 Clock and health (BI-4, BI-7)

- **Skew.** The attendance handshake carries no device time (G12), so skew is
  measured on realtime pushes: received time minus device time, only for lines
  under two minutes old, as a running median of the last 20. Pull agents read
  the device clock directly. Beyond ±3 minutes → `skew` alert; a skew close to
  30 minutes → `timezone-suspect` with the hint "check the handshake TimeZone
  value". The administrator sets the offset; it applies to new punches at
  ingest. Re-applying it to punches already applied creates a pending bulk
  correction of kind `retime-device-events` (§12.1) with the reason "device
  clock offset". On approval the system writes the re-timed events — same kind,
  same evidence, new time, superseding the originals and linked to the
  correction — so the device's own events stay readable (AT-6). A punch whose
  event a person has already corrected is left out: a person's decision is
  changed only by a person.
- **A new time can mean a new person** (D38). Step 6 finds a punch's person
  from the date of its corrected instant (§10.3), and a re-timed event, like
  every correction row, stays with the person of the event it replaces (D34).
  So before a punch goes into the batch, the PIN is looked up again at its new
  instant — the raw punch's `occurred_at` plus the new offset — exactly as step
  6 would: that date in the organization's timezone, the device's own mapping or
  else the connector's, and the holder's employment window. If the answer is
  the same person, the punch is re-timed as above, even when the new time
  carries it to another of that person's days, which re-attribution handles
  (§8.4). If the answer is anyone else, nobody, or a person outside their
  employment, the punch is left as it is and opens a `retime-changes-subject`
  review item instead (§12.2). With PIN 1001 Alice's until Sunday and Bob's
  from Monday, a punch really made at Sunday 23:57 but read at Monday 00:02
  through a five-minute error went to Bob; moving it back to 23:57 must not
  leave it on Bob's day, and moving it to Alice's is a decision about two
  people, so a person makes it (§12.1). Approval repeats the check under the
  locks, because a mapping can change while the batch waits.
- **Silence.** A job every 15 minutes: a device with no contact of any kind —
  the command poll counts — for 60 minutes while any mapped employee's shift
  window is open raises one `silent` alert until it is heard from again, and
  notifies device administrators (BI-7). Alerts go by email through the
  platform mailer after commit until `notifications` (P7) exists.

### 10.7 The other adapters

- **Edge agent** (`packages/biometric-agent`): a small Node program on an
  always-on office machine. It reads LAN devices (ZK pull protocol, Hikvision
  ISAPI, COSEC), keeps unsent punches in local SQLite until acknowledged,
  reports each device's clock, and posts batches to
  `POST /ingest/biometric/v1/batches` over HTTPS with its connector credential,
  signing a timestamp and the body so a captured request cannot be replayed.
- **Vendor APIs**: one scheduled job per connector (§5.4) with a stored cursor.
  Vendor users map to PINs; vendor devices map to `biometric_device` rows.
  Payloads can carry face images or picture links; the adapter strips them and
  never fetches a picture link (DP-2). Each vendor cloud is recorded as a
  sub-processor (DP-9).
- **Webhook**: `POST /ingest/biometric/v1/webhooks/:connectorId`, HMAC-signed,
  same body shape as the agent.
- **File import**: column mapping, a dry-run preview, then the same pipeline.

A new brand therefore needs: an adapter, captured sample payloads as test
fixtures, and a row in the table in §10.1.

### 10.8 API

| Method | Path | Action | Notes |
|---|---|---|---|
| GET | `/api/biometric/devices` | `biometric:manage` | Registry with status, dry-run, last seen, skew, open alerts |
| POST | `/api/biometric/devices` | `biometric:manage` | Register: serial, name, adapter, timezone. Starts `pending`, dry-run |
| PATCH | `/api/biometric/devices/:serial` | `biometric:manage` | Enable or disable, dry-run off, timezone, handshake mode, offset, reader direction and readers, IP allowlist, backfill, stamp mode. A change reaches only the punches that arrive after it (D37), so the answer says when the device was last heard from: punches it still holds from before the change will be read the new way |
| PUT | `/api/biometric/mapping` | `biometric:manage` | PIN ↔ person from a date, for a connector or one device; a PIN already held in that scope names the holder (BI-2), and the same PIN pointing at different people on two connectors is allowed but shown as a warning; the answer counts unmapped punches from the last 30 days ready to replay (BI-3) |
| GET | `/api/biometric/punches` | `biometric:manage` | The punch stream: every punch with its status and reason (BI-8), and how it was read when it arrived |
| POST | `/api/biometric/punches/replay` | `biometric:manage` | Replay unmapped, held or rejected punches by id, PIN or range; applied ones are skipped. A replayed punch keeps the reading it arrived with (D37), and joins a duplicate burst only now, with the person its mapping gives it (§10.3 step 7) |
| — | `/iclock/*`, `/ingest/biometric/v1/*` | machine surface | **G2** |

`biometric:manage` is a sensitive action, so the engine audits every use
(SE-7). Screens: `/company/workforce/biometric` — registry, device detail,
PIN mapping, punch stream.

### 10.9 Connecting the Identix to TapIt

1. Register the device in TapIt: serial (from the device's system information
   screen), name, adapter `zk-adms`, timezone `Asia/Kolkata`, handshake `derive`
   (sends `330`). It starts `pending` and in dry-run. Enable it once it is
   registered: it stays in dry-run, so what it sends is stored and logged but
   writes no attendance (BI-5), while a device that is not yet enabled has its
   pushes logged and discarded (BI-1).
2. Enter the office's static public IP, if it has one, as the device's
   allowlist.
3. Enter the PIN mappings — each employee's number on the device — on the
   mapping screen (§10.8), effective from TapIt's go-live date (Q12).
4. On the device's cloud-server (ADMS) settings, set TapIt's device host and
   port; use a domain name and HTTPS if this firmware offers them. A device
   sends to one server at a time, and its own log keeps every punch whichever
   server it points at.
5. Watch the device page: handshake received, `TimeZone=330` sent, realtime
   pushes arriving, skew near zero, no template lines. Save the captured
   handshake and pushes as parser fixtures (§20).
6. Compare a day of dry-run punches with the device's own log for the same
   people.
7. Turn dry-run off. The device resends its stored log; re-sends are
   recognised and ignored, and a punch that arrived during dry-run never
   becomes attendance, however late it is replayed (D37). Repeated scans of the
   same meaning are marked duplicate, so nothing is counted twice, and punches
   from before the go-live date find no PIN mapping and stay unapplied.

**Done when** the Identix runs on TapIt with every BI acceptance test passing
against its captured payloads, an unregistered serial is refused and logged,
no fingerprint or photo data is ever stored, and a device five minutes fast
produces no false lateness once its offset is set.

---

## 11. Step 6 — Leave and WFH, as attendance sees them

`leave` is its own module with its own screens. This section covers only what
attendance and payroll depend on.

**Tables.** `leave_type` (LV-1 fields, plus `kind`: `absence` or
`attendance-mode` for WFH — LV-1b), `leave_request` (the person, `user_id`;
dates, first/second-half marks on the first and last day, kind, stage, status,
`requested_by`, acknowledgement, decision, an optional recurrence and end date
for standing WFH), `leave_attachment` (resource type `leave_attachment`, which
P4 already checks), and `leave_balance_entry` — a ledger of opening, accrual,
consumption and reversal rows, so opening + accrued − consumed = closing holds
by construction (LV-11). Decision columns carry
`CHECK (decided_by IS NULL OR decided_by <> requested_by)` like
`role_change_request`.

A WFH request is a leave request of kind `attendance-mode`, so it names a date
or a range and takes the same two stages — the manager's acknowledgement, then
HR's decision — and nothing else about the day changes (WFH-1).

**Approval** (`leave:decide`, after the manager stage) is one transaction:

1. Status → approved.
2. When enforcement is on, consumption entries for the days that count —
   holidays and week-offs inside the range consume nothing (LV-3, through
   `CalendarFacade`).
3. `AttendanceFacade.applyOverlay` for each counted day: `leave-full`,
   `leave-first-half` or `leave-second-half` (LV-4), or `wfh`. Each overlay
   carries the request id (L8).
4. For WFH, the `work_from_home_day` rows the login geofence reads (ID-18b).
5. Outbox `leave.decided`; recalculation is queued by the overlay change (LV-5).

| Rule | How |
|---|---|
| LV-2 | Balance checked at submission, deducted at approval, restored on rejection or cancellation — only while enforcement is on |
| LV-7 | A1 at both stages through `requestedBy`, plus the database check |
| LV-8 | Submission refuses an overlap with a pending or approved request, naming it; a leave day and a WFH day on the same date also conflict (WFH-7) |
| LV-9 | Retroactive leave needs a reason, is flagged, and flags any published payslip through `attendance.day-changed` |
| LV-10 | The request shows the named person it is waiting on |
| LV-12 | Types seeded with accrual 0 and enforcement off; the banner; the go-live blocker; enforcement on only when every type has values; the BD-5 table offered as a one-click start that a named person accepts, audited (LV-G1 to LV-G5) |
| WFH-7 | Approving leave over an approved WFH day removes that day's WFH overlay and notifies the employee |
| WFH-8 | A standing arrangement is one approved request with a recurrence and an end date; a daily job keeps its overlays 60 days ahead |
| WFH-9 | In the calculator: a device scan on a WFH day clears the flag; the approval stays |

**Cancelling.** An employee cancels a *pending* request
(`DELETE /api/leaves/:id` sets `cancelled`; nothing is deleted). An *approved*
request is revoked only through `leave:decide`, which removes its overlays by
request id, reverses its balance entries and flags any published payslip. This
closes TapCRM's "employees delete approved leave and the stamps stay" (L7, L8).

**P4 (LV-6).** The attachment loader sets `__holderIsHr` from the principal's
department being the seeded `hr` department — the same meaning P7 gives it —
so a manager acknowledging the request sees the dates, the type and that a
document exists, never its contents.

---

## 12. Step 7 — Corrections, auto-close and reconciliation

### 12.1 Corrections (AT-6 to AT-11)

```sql
CREATE TABLE attendance_correction (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  user_id         uuid NOT NULL,                  -- whose day
  work_date       date NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('add-event', 'replace-event', 'void-event',
                                                 'confirm-as-is', 'retime-device-events')),
  payload         jsonb NOT NULL,                 -- events to add or replace with (in, out, break-start,
                                                  -- break-end only), ids to void, or device events to re-time;
                                                  -- for a punch moved between people, the raw punch's id too
  reason          text NOT NULL CHECK (char_length(reason) >= 20),   -- AT-7
  batch_id        uuid,                           -- AT-11
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by    uuid NOT NULL,                  -- the registry initiator field
  decided_by      uuid,
  decided_at      timestamptz,
  decision_note   text,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, user_id, id),                     -- attendance_event.correction_id points here
  CHECK (decided_by IS NULL OR decided_by <> requested_by),   -- A1
  CHECK (decided_by IS NULL OR decided_by <> user_id)         -- nobody applies a correction to their own day (G4)
);
-- Step 7 adds the key attendance_event.correction_id has waited for since step 3 (§8.1):
-- a correction's rows belong to the person whose day it corrects (D34).
ALTER TABLE attendance_event
  ADD FOREIGN KEY (organization_id, user_id, correction_id)
      REFERENCES attendance_correction (organization_id, user_id, id);
```

- **Who asks** (AT-8). An employee asks about their own day
  (`POST /api/attendance/corrections/request`). A reviewer raises one for
  someone else's day (`POST /api/attendance/corrections`). Both start pending.
- **Who applies.** A different reviewer approves
  (`POST /api/attendance/corrections/:id/approve`). The engine blocks the
  initiator (A1); the database blocks the initiator and the subject. Where the
  only eligible reviewer is the requester, the item escalates to Super Admin
  instead of stalling (SD-3).
- **What a correction may state.** A person says when someone arrived, left or
  took a break — `in`, `out`, `break-start`, `break-end`, always `confirmed` —
  and never creates a `scan` or an `auto-out`; the database refuses anything
  else (§8.1). The one correction that moves device evidence without restating
  it, `retime-device-events` (§10.6), is approved by a person like any other,
  but its rows are written by the system: same kind, same evidence, new time,
  linked to the approved correction.
- **What approval does**, in one transaction: takes the person's advisory lock
  — every person's, in ascending user-id order, when a batch touches more than
  one (§8.4) — locks the day's record, **checks that every event the correction
  targets is still effective** — not already superseded or voided by another
  correction approved in the meantime, else 422 `CORRECTION_TARGET_SUPERSEDED`
  naming it — and **that the day reads cleanly with the correction in it**:
  every `in`, `out` and break event the correction states must be applied by
  `readDay` (§5.3) — re-timed device events are evidence and are read like any
  other — so an `out` before the arrival or in its own second, a `break-end`
  with no break open, or a punch after the departure is refused with 422
  `CORRECTION_NOT_READABLE` naming it (a later departure is a `replace-event`,
  not an added `out`). Then it appends correction events that supersede or void
  the originals (the device's events stay readable, marked superseded, AT-6),
  re-attributes the neighbourhood and re-derives the closures it touched (§8.4
  steps 9–10), bumps the day's input version, rebuilds the projection, queues
  recalculation and writes the audit entry. For a published period,
  recalculation flags the payslip rather than touching it (AT-9). So a
  correction never adds a punch the day would not use.
- **Approving a clock correction** (`retime-device-events`) goes punch by
  punch, because the system built the batch and nobody wrote its rows by hand.
  Under the locks, each punch is checked again. If its event is no longer
  effective — a person's correction replaced it while the batch waited — it is
  left alone and named in the answer, rather than failing the batch with
  `CORRECTION_TARGET_SUPERSEDED`. If the PIN's holder at the new instant is no
  longer the event's person (§10.6), it is not re-timed and opens
  `retime-changes-subject`. Every other punch is re-timed. The generic retime
  never silently keeps the old person.
- **Moving a punch to another person** — the answer to `retime-changes-subject`
  — is two corrections raised together under one `batch_id`: a `void-event` on
  the day of the person who has the punch now, and an `add-event` on the day of
  the person the mapping names at the corrected instant, with the raw punch's
  id carried in both payloads as their evidence. The raw punch itself cannot
  move — its person is fixed once an event points at it (§10.4) — so that id,
  the provenance of both days and the audit entry are how anyone follows where
  it went. The added event is what a person states: an `in`, `out` or break,
  `confirmed`, so a scan becomes the `in` or `out` the reviewer decides it was.
  The pair is approved as a unit, by someone other than the requester and
  other than either person, in one transaction that takes both people's locks
  in ascending user-id order. Where the new instant has no holder, or a holder
  who was not employed then, the void is raised alone — or the mapping or the
  employment dates are fixed first and the item is checked again, which then
  re-times the punch like any other.
- **Corrections near a boundary move events between days.** Voiding the
  `05:02 out` that closed a night makes the `07:30 out` belong to that night
  again, so approval re-runs attribution across the previous, current and next
  day and recalculates every record whose events moved (§8.4 step 9). A
  correction may also *pin* an event to a day — "this 07:30 punch is Sunday's"
  — and a pinned assignment is never moved by the automatic rule afterwards.
- **One chain, not a fork.** The partial unique index
  `ux_attendance_event_supersedes` (§8.1) means an event can be superseded once
  and only once, so two corrections
  approved seconds apart cannot leave the day with two competing versions of
  the same punch. Without it the second approval would simply win at read time,
  quietly, and the provenance trail would branch.
- **Older than 60 days** (AT-10): a privileged constraint that `attendance`
  registers with the engine denies `attendance:correct` on such a day to anyone
  but Super Admin. It is an authorization rule, so it lives in the engine
  (NF-24), not in the handler.
- **Bulk** (AT-11): one date, many people, one reason, one batch, approved as a
  unit by someone other than the requester — the device-outage case.
- **Reject** has no route yet (G8).

### 12.2 The review queue

`attendance_review_item` holds days a person must look at: auto-closed with an
assumed time, overtime resting on an assumed departure, a departure with no
arrival before it, an `out` in the arrival's own second
(`same-instant-conflict`), a scan an `alternating` reader read out of turn, an
earlier punch that displaced a duplicate a person had already corrected, a night
left open when the next shift started (`previous-session-unconfirmed`), a day
auto-close could not close after three attempts, a closure re-derived inside a
frozen or published period, remote without approval (WFH-6), punched on leave,
holiday worked, activity after finish, late-synced offline punch, an event
outside the shift window that might have been a real early start, overlapping
shift windows, not evaluated (no shift), and a clock correction that would carry
a device punch to someone else, to nobody or to a person outside their
employment (`retime-changes-subject`, §10.6) — raised on both people's days
when there are two, so neither person's payroll can publish past it. An item
closes with a correction —
`confirm-as-is` when the day is right as recorded, still with a reason and a
second person. Payroll will not publish while any item for the period is open
(PY-7).

**Items are keyed by the day, the kind and the evidence they question** — an
event id wherever there is one. A recalculation therefore never reopens an
item a reviewer has already closed for the same evidence; new evidence opens a
new item; and an item whose evidence has been retired — an `auto-out` replaced
after late punches, say — resolves itself with a note naming what replaced it.

Screens: `/company/workforce/attendance/corrections` (requests, pending
corrections and flagged days together) and a "request a correction" action on
the employee's day detail.

### 12.3 Auto-close (LS-6)

Auto-close is one decision function and one job.

```
closeDecision(the day's effective events without its own auto-out,
              its eligibility window, closingCap, now)              pure, no I/O
  reading = readDay(events)                                          (§5.3)
  reading.departure exists       → closed by that punch; no auto-out   (D31)
  now < closingCap               → still open
  reading.arrival is none        → no-show
  arrival, but no departure      → one auto-out, evidence 'assumed', at
                                     the last eligible scan in a LATER second than
                                       the arrival, if no eligible event is later;
                                     else the shift end, if that is later than
                                       the last eligible event;
                                     else the last eligible event's time
                                   never earlier than the day's last eligible event
                                   (L5), and read last in its second, so it is the
                                   departure even when it shares one (§5.3)
```

- **The job**, hourly per organization, selects `state = 'open' AND
  close_due_at <= now()` — no lookback, so an old open day cannot be forgotten
  (L6) — and applies the decision to each day in its own transaction.
- **The same function runs again whenever a day's evidence changes** — an
  append, a correction, a replay, a moved `closingCap` (§8.4 step 10, §8.5).
  That is what makes a closure derived rather than recorded (D25); §12.4 says
  exactly what a changed answer writes.
- The `auto-out` is written against its record explicitly, with assignment
  reason `system-close`: it belongs to the day it closes, whatever the geometry
  says about its instant. When its time came from the shift end or a non-scan
  event, the day is flagged `assumed-departure` and a review item opens.
  Whatever its basis, any overtime resting on an `auto-out` waits for review
  under the calculator's rule (§8.2).
- `closed_by` follows the decision: `punch-out` for an `out` from a device, the
  web, mobile or an import; `correction` for an `out` a correction added;
  `auto-close` for an `auto-out`; `no-show` for no arrival.
- **Failures are bounded, and a failed day is never forgotten.** The job key is
  `auto-close:{recordId}:{inputVersion}`, plus the runner's generation (§5.4).
  One key gets a few retries with backoff, then dead-letters with an alert; the
  hourly selector keeps offering that key and the queue ignores it, so a
  failing day is never re-run every hour (L5). Any new punch or correction on
  the day is a new input version, and so a fresh key. Without one, the hourly
  selector — which is also the recovery sweep, since it selects open days past
  their due time — enqueues the key's next generation once a day has passed,
  at most three generations. After the third the day is flagged
  `auto-close-failed` and a review item opens; like any open day it blocks
  payroll (PY-7), and a reviewer's correction — usually adding the departure —
  is a new input version and a new attempt. No endless retries, and no open
  day that nobody knows about.
- **The due time is `closingCap`, not the geometric window end** (§5.2). For a
  20:00–05:00 night before a 09:00 morning that is 09:00, not 07:00. Capping it
  at the day window would let auto-close shut a session at 07:00 that
  attribution would still accept a real punch-out into at 07:30 — the job would
  be racing the model it belongs to. The maximum closing extension is an
  organization setting (`shift_setting`, dated; Q3 — TapCRM uses 4 hours),
  overridable per shift version.
- **Auto-close takes the person's advisory lock** before it reads the session,
  in the same order as every other writer: advisory lock on the person, then
  the record row (§8.4). Without the lock a 07:59:59 auto-close and an 08:00:00
  punch-out could each decide the session was open and produce two departures.

### 12.4 Late evidence: closures are re-derived, not patched

**The problem.** Auto-close has to decide a day's ending with the evidence it
has at `closingCap`, and a device that was offline delivers evidence later.
Every way that can happen must end in the day that on-time delivery would have
produced:

| Delivered late, after auto-close ran | What auto-close had decided | The day on time |
|---|---|---|
| The real `07:30 out` for a night that began `20:00 in` | `auto-out` at the 05:00 shift end | Departure 07:30 |
| A whole night, `20:00` and `08:30` scans, on a one-terminal night-after-night roster | `no-show` — it saw nothing | Departure 08:30 from the last scan, the overtime waiting for review |
| The `08:30` scan alone, the `20:00` scan having arrived on time | `auto-out` at the 05:00 shift end | Departure 08:30 from the last scan, the overtime waiting for review |
| The `20:00 in` alone — nobody punched out | `no-show` | `auto-out` at the shift end, flagged, with a review item |

An earlier revision retracted an `auto-out` only for a late *confirmed
departure*. That fixed the first row and left the other three depending on when
the terminal reconnected — and in the second row the late scans even came
through with their overtime and no review item, because the "not credited"
rule then lived inside auto-close.

**The rule** (D25) has two parts, and each needs the other:

1. **Attribution never sees the system's rows.** An `auto-out` is not a
   departure for attribution (§5.2). On time it cannot exist yet — auto-close
   writes it at the cap — so a late punch is attributed exactly as it would
   have been on time.
2. **The closure is re-derived.** After attribution, `closeDecision` (§12.3) is
   applied again to every day whose evidence changed (§8.4 step 10). If its
   answer differs from the day's current closure, the difference is written,
   append-only:
   - an `auto-out` that no longer fits gets a **void row** — `source =
     'system'`, `is_void = true`, `supersedes_event_id` = the `auto-out`,
     assignment reason `reconciliation`, pinned. The `auto-out` itself stays
     readable, so "the system assumed 05:00, the terminal later showed 07:30"
     is a sequence anyone can read back (AT-6, AT-12);
   - a new `auto-out` is appended when the new answer needs one (reason
     `system-close`);
   - `state`, `closed_by` and `closed_at` follow the new answer, and the day is
     flagged `reconciled-from-auto-close`; the queued recalculation then sets
     `departure_at` and the minutes, as it does for any change;
   - the review item for the old answer resolves itself with a note naming both
     answers, and the new answer opens its own when it needs one (§12.2).

Part 1 is also what keeps part 2 from looping: the rows a closure writes are
invisible to attribution, so re-deriving can never move an event.

**Each `auto-out` is retired at most once.** `ux_attendance_event_supersedes`
(§8.1) allows one void row per `auto-out`, so a day whose evidence changes three
times ends with a chain of retired `auto-out` rows and one current closure —
never a fork, and never two current departures.

**Where it applies, and where it does not.**

| Case | What happens | Why |
|---|---|---|
| A late punch **after** the day's `closingCap` | Attributed by the ordinary rules. Where it still lands on this day — a long gap puts the boundary after the cap — it is outside the eligibility window, so it can be neither arrival nor departure, and the closure is untouched | Past the cap the punch is not evidence about this session (§5.2, §8.2) |
| A day already closed by a real `out` or by a correction | The late punch is attributed like any other; the decision still sees that `out`, so no `auto-out` appears and none is retired | A guess never replaces a real departure, and a human decision is changed only by a human |
| A punch older than the device's backfill window | `held` until an administrator replays it (§10.3); the replay runs this same path and ends in the same day | Old logs must not rewrite history without someone deciding to |
| The period is **frozen or published** | Re-derivation still happens; the payslip is flagged, a review item is raised, and publishing is blocked until someone clears it (PY-7) | See below — attendance records what happened; money is protected by the snapshot, not by refusing evidence |

**A frozen or published period does not stop it** (D27). There were two
consistent models available and this design takes the second:

| Model | What it means | Why not / why |
|---|---|---|
| Hold the punch | A punch landing on a frozen day never becomes an effective event; it stays as `biometric_punch` evidence behind a pending correction until a reviewer approves it | It makes attendance wrong on purpose. A terminal that was offline on the 31st and pushes its backlog on the 2nd would leave a whole shift's worth of people showing assumed departures, and a queue of hundreds of items to approve one by one. It is also a **new** rule: nothing else in this system refuses evidence because of payroll state |
| **Record it, gate the money** ✓ | The punch is appended and the closure re-derived, like any other day. The run's frozen snapshot is untouched (D20), the day's `calculation_version` moves, the payslip is flagged through `attendance.day-changed`, a run in flight refuses to publish and names the employee to regenerate (§14.4), and a published payslip carries its flag (AT-9) | It is what the system already does for an approved correction to a published period (§12.1) and for retroactive leave (LV-9). Attendance is the ledger of what happened; payroll is a snapshot of it at a moment. One mechanism, already built, already tested |

So the freeze changes nothing about attribution or the closure, and everything
about what payroll is allowed to do next. The one addition is that a
re-derivation inside a frozen or published period **always** raises a review
item, even though it applies automatically, so that the publish gate has
something to hold (PY-7).

**Why this is not "just let the reviewer sort it out".** The device-outage case
is the ordinary one on a site with a single terminal and a flaky uplink, and a
review queue that gains a day per employee per outage is a queue nobody reads —
at which point the queue stops protecting anything, which is how TapCRM's flags
ended up ignored. Automatic re-derivation is safe because it only ever replaces
the system's own guess, with the answer the same rule gives on the fuller
evidence, and it leaves every row behind.

**Done when** a reviewer applies an employee's request while the original
device events stay visible as superseded; every day has exactly one current
closure; each row of the table above — a late departure, a night delivered
after a no-show, a late scan after a shift-end guess, a lone late arrival —
produces the day it would have produced on time; and the TapCRM 17 August
sequence — two door scans seconds apart, then an app break — closes with one
punch-out after the break.

---

## 13. Step 8 — Break management (P2)

**In plain words.** Breaks are always recorded. Nothing is governed until HR
creates a policy (BM-0). A policy sets limits; a breach becomes a record; a
consequence that touches attendance or pay waits for a person to confirm it,
and even then it never edits a punch.

**Tables.** `break_policy` (versioned by effective date — BM-16; the limit
fields from PRD §9.5; grace — BM-2; lower limit advisory by default — BM-3;
warning percentage, 80 by default — BM-12; whether break time is paid),
`break_penalty_rule` (ordered; condition, occurrence window of day / week /
month and count; consequence; `auto_apply` false by default — BM-5, BM-6),
`break_policy_assignment` (target: organization, department, position, shift,
team or person; priority — one editor for a company-wide baseline and for named
people, BM-0b), and `break_breach` (the person, `user_id`, with
`UNIQUE (organization_id, user_id, id)` for the keys that point at it; date,
measured values, rule matched, occurrence number, consequence, status `pending`
/ `confirmed` / `waived` / `superseded` / `advisory`, explanation — BM-13,
reviewer with `CHECK (reviewed_by <> user_id)` — BM-9).

| Rule | How |
|---|---|
| BM-13 | A `require-explanation` consequence prompts the employee at their next login, and the note attaches to the breach |
| BM-1 | Resolution picks the most specific match: person → team → shift → position → department, ties by priority; the resolved policy is stored in the day's inputs and shown on the employee record |
| BM-4 | Rules are checked in order; the first match wins |
| BM-5, BM-6 | Attendance- or pay-changing consequences start `pending` unless the rule is set to apply automatically, which the screen says and the audit records |
| BM-7 | Confirming writes an `attendance_overlay` of kind `breach-consequence`, or a `payroll_input` line for `deduct-amount` (BM-10); punches and break sessions are never edited |
| BM-8 | Waiving needs a reason, deletes that overlay by breach id, recalculates, and flags a published payslip |
| BM-11 | `GET /api/breaks/allowance/me`: limit, used today, remaining |
| BM-12 | On each break event `live-status` compares usage with the limit and returns a warning in the punch response at the set percentage |
| BM-14 | The calculator records the consequence as "superseded by leave" on leave and holiday days |
| BM-15 | Flexible staff are judged on total break time only |
| BM-16 | `POST /api/breaks/policies/:id/preview` re-evaluates history and writes nothing |

**Evaluation** runs hourly (TECH §11 "end of shift") and selects **by state,
not by clock** (D21): `state = 'closed' AND (breaks_evaluated_version IS NULL
OR breaks_evaluated_version < calculation_version)`. "Days closed in the last
hour" would be the same trap auto-close used to fall into — two hours of
downtime and those days would never be evaluated, and nobody would notice,
because the absence of a breach looks exactly like a clean day. Writing the
version back makes a re-run a no-op, and a recalculated day is re-evaluated
automatically because its calculation version moved. Monthly occurrence
counters reset on the 1st.

PRD §18's P2 exit applies: penalties run in review mode first, and automatic
application is switched on only after a month of confirmed accuracy.

---

## 14. Step 9 — Payroll (P2)

**In plain words.** A payroll run takes a frozen copy of the month's stored
attendance, works out each person's payslip line by line, lets HR review the
unusual ones first, and publishes. Publishing locks the payslips for good and
posts one balanced accounting entry. A later mistake is fixed with a new,
linked revision — never by editing.

### 14.1 Tables

```sql
-- PY-4: versioned by effective date. Ships EMPTY (D15); a named person adopts each version.
CREATE TABLE payroll_config (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  effective_from  date NOT NULL,
  settings        jsonb NOT NULL,       -- PF, ESI, PT by state, LWF, rounding, pay period; zod-validated
  accepted_by     uuid NOT NULL,
  accepted_at     timestamptz NOT NULL,
  UNIQUE (organization_id, effective_from)
);

-- Salary history with effective dates (TapCRM had none — a raise applied to the whole month).
CREATE TABLE salary_structure (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  user_id         uuid NOT NULL,
  effective_from  date NOT NULL,
  effective_to    date,
  currency        text NOT NULL,
  reason          text NOT NULL,
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  EXCLUDE USING gist (organization_id WITH =, user_id WITH =,
                      daterange(effective_from, effective_to, '[)') WITH &&)
);
CREATE TABLE salary_structure_line (
  organization_id uuid NOT NULL,
  structure_id    uuid NOT NULL,
  code            text NOT NULL,        -- BASIC, HRA, SPECIAL, …
  name            text NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('earning', 'deduction', 'employer-contribution')),
  monthly_amount  numeric(14,2) NOT NULL,
  prorated        boolean NOT NULL DEFAULT true,
  statutory_bases text[] NOT NULL DEFAULT '{}',   -- which statutory wages include it, e.g. {'pf','esi'}
  sort            smallint NOT NULL,
  PRIMARY KEY (organization_id, structure_id, code)
);

-- Named lines from other modules and from HR (PY-9, BM-10).
CREATE TABLE payroll_input (
  id, organization_id, user_id, period_start date,
  kind            text CHECK (kind IN ('break-deduction', 'adjustment', 'advance-recovery',
                                       'arrear', 'bonus', 'tds')),
  amount          numeric(14,2) NOT NULL,
  label           text NOT NULL,        -- what the employee reads on the payslip
  break_breach_id uuid,                 -- a typed reference, with its own foreign key
  reason          text NOT NULL, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'break-deduction') = (break_breach_id IS NOT NULL)),
  FOREIGN KEY (organization_id, user_id, break_breach_id)          -- the same person's breach (D34)
    REFERENCES break_breach (organization_id, user_id, id)
);
-- A retried breach confirmation must not deduct twice.
CREATE UNIQUE INDEX ux_payroll_input_source
  ON payroll_input (organization_id, kind, break_breach_id) WHERE break_breach_id IS NOT NULL;

CREATE TABLE payroll_run (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  period_start    date NOT NULL,
  period_end      date NOT NULL,
  status          text NOT NULL CHECK (status IN ('draft', 'computing', 'review', 'publishing',
                                                  'published', 'failed', 'cancelled')),
  config_id       uuid NOT NULL,
  snapshot_at     timestamptz,
  job_run_id      uuid,
  employees_total integer, employees_done integer, employees_failed integer,
  created_by      uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  published_by    uuid, published_at timestamptz
);
CREATE UNIQUE INDEX ux_payroll_run_live ON payroll_run (organization_id, period_start)
  WHERE status NOT IN ('failed', 'cancelled');          -- one live run per period

CREATE TABLE payroll_run_employee (
  organization_id uuid NOT NULL, run_id uuid NOT NULL, user_id uuid NOT NULL,
  inputs          jsonb NOT NULL,       -- the WHOLE frozen input set (§14.4): per-day units with
                                        -- {recordId, calculationVersion}, employment window,
                                        -- salary structure versions and lines, payroll inputs (D20)
  inputs_fingerprint text NOT NULL,     -- SHA-256 of that set's canonical form (§14.4, §14.6)
  inputs_changed  boolean NOT NULL DEFAULT false,   -- a screen hint; publish re-checks for real
  status          text NOT NULL CHECK (status IN ('pending', 'computing', 'computed', 'failed', 'excluded')),
  error           text,
  previous_net    numeric(14,2),
  variance        numeric(14,2),        -- PY-8
  PRIMARY KEY (organization_id, run_id, user_id)
);

CREATE TABLE payslip (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  run_id           uuid NOT NULL,
  user_id          uuid NOT NULL,
  period_start     date NOT NULL,
  revision         smallint NOT NULL DEFAULT 0,
  supersedes_id    uuid,
  revision_reason  text,
  status           text NOT NULL CHECK (status IN ('draft', 'published')),
  gross            numeric(14,2) NOT NULL,
  total_deductions numeric(14,2) NOT NULL,
  net              numeric(14,2) NOT NULL,
  currency         text NOT NULL,
  total_units      smallint NOT NULL,   -- half-days in the period
  paid_units       smallint NOT NULL,
  lop_units        smallint NOT NULL,
  published_at     timestamptz,
  UNIQUE (organization_id, user_id, period_start, revision),
  UNIQUE (organization_id, user_id, id),
  -- A revision replaces the same person's payslip, never a colleague's (D34).
  FOREIGN KEY (organization_id, user_id, supersedes_id) REFERENCES payslip (organization_id, user_id, id),
  CHECK (net = gross - total_deductions),                     -- L4
  CHECK ((revision = 0) = (supersedes_id IS NULL)),
  CHECK (revision = 0 OR revision_reason IS NOT NULL)
);
CREATE TABLE payslip_line (organization_id, payslip_id, code, label,
  kind text CHECK (kind IN ('earning', 'deduction', 'employer-contribution', 'info')),
  amount numeric(14,2) NOT NULL, basis jsonb NOT NULL, sort smallint,
  PRIMARY KEY (organization_id, payslip_id, code));
-- Trigger: publishing checks gross and total_deductions against the line sums; after that,
-- UPDATE and DELETE on the payslip and its lines are refused for every role (A3, PY-5).

CREATE TABLE payslip_document (organization_id, payslip_id, object_key, sha256, rendered_at);  -- write-once bucket (FS-6)
CREATE TABLE payslip_flag (organization_id, payslip_id, reason, source_type, source_id,
                           raised_at, resolved_by_payslip_id);                                  -- AT-9, BM-8, LV-9, HO-3
CREATE TABLE ledger_posting_intent (organization_id, source_type, source_id, lines jsonb,
                                    created_at, consumed_at);                                   -- D16, until P6
```

### 14.2 Run states (SM-3)

```
draft ──start──► computing ──all computed──► review ──publish──► publishing ──► published
                    │                          │  ▲
                    └──any employee failed──►  │  └── regenerate some or all employees
                          failed               └──cancel──► cancelled
```

A draft payslip is never visible to the employee and never notified (TapCRM
notified people about drafts they could not open).

### 14.3 The calculation

`computePayslip(inputs, structures, config, payrollInputs)` is pure. Money is
integer paise; rates are exact decimals; rounding is half-up to the rupee,
**once per line** (PY-3, D14).

```
Units are half-days. A calendar month of D days has 2 × D units.

For each salary structure in force during the month (a mid-month raise gives two):
  its units       = 2 × days it covers
  its loss of pay = Σ unpaid-leave units + absent units on those days             PY-2
  not employed    = 2 × its days outside the employment window (from the window, not from rows)  L23
  its paid units  = its units − its loss of pay − not employed
  each prorated line   += monthly amount × its paid units ÷ month units   (rounded once, at the end of the line)
Lines not prorated are paid in full, from the structure in force on the last day.

Then statutory lines from payroll_config, then payroll_input lines,
gross = Σ earnings, total deductions = Σ deductions, net = gross − total deductions.
```

Days are counted by **work date**, so a night shift that starts on the last of
the month and ends on the first of the next is one day in the earlier month
(§6.6). Week-offs and holidays are paid units, so full attendance pays the full
salary:
₹40,000 in September is ₹40,000 gross, where TapCRM's Auto Payroll gave
₹29,333 (L22).

Why rounding per line matters — 28.5 paid days out of 30 (57 of 60 units):

| Line | Monthly | × 57 / 60 | Paid |
|---|---|---|---|
| Basic | 16,667.00 | 15,833.65 | 15,834 |
| HRA | 11,667.00 | 11,083.65 | 11,084 |
| Special | 4,999.00 | 4,749.05 | 4,749 |
| **Gross** | 33,333.00 | 31,666.35 | **31,667** = the sum of the lines |

Rounding only the total would print 31,666 — a rupee away from the lines above
it, which is exactly the discrepancy PY-3 forbids.

A person with not-evaluated working days (no shift) or open days in the period
is not computed; the run names them.

### 14.4 Snapshot and later changes (PY-1)

**Everything the calculation touches is frozen, not just attendance** (D20).
Salary structures and their lines, payroll inputs, the employment window and
the config version are read *once*, at the start, in the same consistent read
as the attendance days, and stored in `payroll_run_employee.inputs`. The
compute jobs read nothing else. Otherwise HR editing a salary or adding a bonus
while a run is in flight gives employee A one version and employee B another
inside a single payroll — a difference nobody would find by looking at the
payslips.

Starting a run:

1. One consistent read (`REPEATABLE READ`) over the period for every included
   employee: attendance days with their `calculation_version` and their night
   minutes, employment window, salary structure versions and lines, payroll
   inputs, config version.
2. **Completeness check.** Each employee must have a day for every date in
   **the period intersected with their employment window** — not for every date
   in the period, which would fail every joiner and leaver. Someone who joined
   on 15 September needs the 15th to the 30th; the first fortnight is not
   missing data, it is time they were not employed, and payroll treats it as
   not-employed units from the window itself. A date inside the window with no
   row means day-open has a gap (§8.6), and the run stops naming those dates
   rather than reading "no row" as "nothing happened".
3. A stale day — one still recalculating — holds the start until it is fresh,
   or the start fails naming it.
4. All of it is written into `payroll_run_employee.inputs`, together with an
   `inputs_fingerprint`: a SHA-256 over the canonical form of the **whole**
   frozen set — the `{recordId, calculationVersion}` pairs, the employment
   window, the salary structure version ids with their lines' values, the
   payroll input ids with their values, and the config id. It hashes the values
   themselves, not timestamps: neither `salary_structure_line` nor
   `payroll_input` carries an `updated_at`, and a timestamp is only as good as
   every writer remembering to set it. The day versions are kept as a list as
   well, so a drift message can name the days that moved rather than only
   saying "something changed".

A later change to one of those days arrives as `attendance.day-changed` and
marks that employee `inputs_changed` — for a live run in **any** state, draft,
computing or review, not only for published periods. That marker is a hint for
the screen. It is never the safety net, because an event can always be in
flight when someone presses publish; the real check is in the publish
transaction (§14.6 step 2).

### 14.5 Computing and reviewing (PY-8, PY-10, TECH §18)

- A background job computes each employee in their own short transaction,
  several in parallel, reporting progress through `job_run` and the run's
  counters — which is how 2,000 employees fit in three minutes. Each worker
  reads **only** its row's frozen inputs (D20) and moves that row
  `pending → computing → computed`, so two workers can never disagree about
  what a salary was, and a crashed worker leaves a visible `computing` row
  rather than a silent absence.
- If any employee fails, the run ends `failed`. Its drafts are invisible and
  are replaced when the run is started again, so a failure leaves no payslip
  anyone can see (PY-10).
- The review grid shows paid days, loss of pay, gross, deductions, net and the
  variance against the previous published month, **sorted by the size of the
  variance** (PY-8), with each line's basis one click away.

### 14.6 Publishing (PY-5, PY-7, PY-11)

One transaction:

1. Lock the run; it must be in `review`.
2. **Gate (PY-7), all of it inside this transaction:**
   - **Recompute `inputs_fingerprint` from the database and compare it**, per
     employee. That covers everything the payslip was built from, not only
     attendance: a salary edited during review, a bonus added, a payroll input
     amended, a changed joining date, a new config version. Anything that moved
     stops the publish and names the employees to regenerate. The kept day
     versions turn "something changed" into "these three days changed". This is
     the check that matters: `inputs_changed` is set by an event that can
     arrive after the publish began, so trusting it alone means publishing
     numbers that have since changed (D20).
   - `AttendanceFacade.openItems` and `BreakFacade.unresolvedBreaches` for
     every included person and date: pending corrections, open review items,
     open or not-evaluated days, unresolved breaches.
   - Anything found → 422 `PAYROLL_NOT_PUBLISHABLE` with the list (WF-4).
3. Payslips draft → published; the trigger checks every total against its
   lines.
4. `LedgerFacade.post`: debit Salary Expense, credit Salary Payable (LG-4),
   with the statutory liabilities split out as the chart of accounts defines.
   Until `accounting` exists, the balanced entry is stored as a posting intent
   in this same transaction (D16).
5. Run → published; audit; outbox `payroll.published`. After commit, a job
   renders each PDF into the write-once bucket (FS-6) and notifies employees.

### 14.7 Revisions and flags

- **Flag.** `attendance.day-changed` for a published period — from a
  correction, a leave change, a breach waiver or a holiday change — adds a
  `payslip_flag`. The payroll dashboard lists flagged payslips; nothing else
  happens to them.
- **Revise** (`POST /api/payroll/payslips/:id/revise`, with a reason):
  recompute that person from current inputs, plus any adjustment HR adds;
  insert revision n + 1 that supersedes the original, publish it in the same
  transaction, post the difference to the ledger, resolve the flags, and notify
  the employee with the reason. Both payslips are kept (PY-5).

### 14.8 Who can read what

| Rule | How |
|---|---|
| P2, PY-6 | The payslip loader returns `{ type: 'payslip', subjectId, __holderHasPayrollManage }`, the flag coming from the engine's `holdsPolicy(ctx, 'payroll:manage')`; P2 then admits only the subject and payroll managers |
| PY-6b | `GET /api/payroll/payslips/mine` is always filtered to the caller, whatever scope they hold, so `payroll:view` at `all-people` never lists anyone else's payslip |
| PY-12, P7 | Payroll posts to the ledger and never reads it |
| SE-7 | `payroll:view` and `payroll:manage` are sensitive, so every use is audited |
| Logs | No payslip amount is ever logged (TECH observability rules) |

### 14.9 API

| Method | Path | Action | Resource loaded |
|---|---|---|---|
| GET | `/api/payroll/payslips/mine` | `payroll:view` | — |
| GET | `/api/payroll/payslips/:id` | `payroll:view` | payslip, with the holder flag |
| GET | `/api/payroll/runs` | `payroll:manage` | — |
| POST | `/api/payroll/runs` | `payroll:manage` | — (creates a draft run) |
| PATCH | `/api/payroll/runs/:id` | `payroll:manage` | the run; `immutable: true` once published, so A3 refuses edits |
| POST | `/api/payroll/runs/:id/publish` | `payroll:manage` | the run |
| POST | `/api/payroll/payslips/:id/revise` | `payroll:manage` | the payslip's **run** — see G5 |
| GET | `/api/payroll/structures` | `payroll:manage` | — |
| PUT | `/api/payroll/structures/:userId` | `payroll:manage` | a subject-keyed run resource — see G5 |
| GET, PUT | `/api/payroll/config` | `payroll:manage-config` | — (adoption records the accepting person) |

Screens: `/company/workforce/payroll` (cycle dashboard, run and review grid),
`/company/workforce/payroll/structures`, `/company/workforce/payroll/payslips`
(register), `/company/payslips/mine`, statutory configuration.

**Statutory configuration** holds PF (rates, the wage ceiling and whether it is
prorated — Q9, which lines count as PF wages), ESI (rates, eligibility limit,
contribution periods), professional tax (state slabs), LWF, TDS (a monthly input
to start with), the night-allowance method and its threshold if the organization
pays one (§6.6, Q13) — the night window itself is an attendance setting, since
attendance measures the minutes — rounding and the pay period. The CA supplies
every value and a named person accepts it (Q8); nothing is carried over from the
old system. India's labour codes, in force since 21 November 2025, define
"wages" so that when excluded allowances such as HRA together exceed half of
total pay, the excess counts as wages. That changes which amounts form the PF
base, so any salary split — the 50 / 35 / 5 / 5 / 5 of basic, HRA and allowances
Tapvera uses today among them — should be checked against it before it goes into
a salary structure.

**Done when** a full cycle reconciles with attendance for every employee (the
PRD P2 exit), a published payslip cannot be changed by any principal including
Super Admin, and a correction after publication flags the payslip without
altering it.

---

## 15. Background jobs

All run through the step-0 runner: per-organization context, `job_run` rows,
idempotent keys, bounded retries (JB-1 to JB-4).

| Job | Module | When | Key | Purpose |
|---|---|---|---|---|
| Day-open | attendance | 00:05 organization time, then forward from the organization's watermark | `day-open:{org}:{date}` | A record for every employee, every day, with no gaps after an outage (D3, D21) |
| Recalculate | attendance | on demand | `recalc:{org}:{record}:{inputVersion}`, plus generation (§5.4) | AT-2, AT-I4 |
| Stale sweeper | attendance | every 5 minutes | — | Re-queues records left stale |
| Presence rollover | live-status | every 5 minutes | `presence-rollover:{org}:{slot}` | Moves `user_status` rows whose `rollover_due_at` has passed onto the person's new day (§9.3) |
| Auto-close | attendance | hourly (TECH §11) | `auto-close:{record}:{inputVersion}`, plus generation (§5.4) | LS-6: applies `closeDecision` to open days that became due. Re-deriving after late evidence is not a job — it runs inside the transaction that brought the evidence (§12.4) |
| Device health | biometric | every 15 minutes (TECH §11) | `device-health:{org}:{slot}` | BI-4, BI-7 |
| Vendor pull | biometric | every 1–5 minutes per connector | `pull:{connector}:{cursor}` | Vendor adapters |
| Backlog processing | biometric | on demand | `punch:{punchId}` | Large device pushes |
| Acknowledgement timeout | leave | hourly | `ack-timeout:{request}` | Manager stage auto-advances after 24 h |
| Standing WFH | leave | daily | `wfh-standing:{org}:{date}` | WFH-8, 60 days ahead |
| Break evaluation | break-management | hourly, selecting closed days whose evaluated version is behind their calculation version | `breach-eval:{record}:{calcVersion}` | TECH §11 "end of shift"; never a time-window query (D21) |
| Payroll generation | payroll | on demand | `payroll:{run}` | PY-10 |
| Payslip rendering | payroll | after publish | `payslip-pdf:{payslip}` | FS-6 |

---

## 16. Security, privacy and retention

| Topic | Rule |
|---|---|
| Biometric data (DP-2) | No template, face image or photo is requested, stored or logged. The ADMS handshake asks only for attendance and operation logs; stray template lines are discarded unread; vendor payload images are stripped and picture links never fetched. Enrolling a person on a second device is done at that device — the product never copies templates between devices |
| Location (DP-3, ID-15a) | Coordinates exist only inside the identity geofence, as today; on a WFH day none are requested or stored |
| Retention (DP-6) | Attendance events, records, raw device punches and corrections: 7 years. Payroll: 7 years. Audit: 7 years |
| Notice (DP-7) | Employees are told in-product what is recorded: punches, breaks, which device, location where fenced. Nothing is scaled or monitored silently (L20) |
| Sub-processors (DP-9) | Each vendor cloud connected through an adapter is recorded with what it receives |
| Device surface | Preferably not public at all: an on-site edge agent, tunnel or LAN reverse proxy, so the internet only sees an authenticated connection (§10.5). Where the legacy endpoint must be exposed, it gets its own hostname serving only `/iclock/*` and `/ingest/biometric/*`, HTTPS wherever the firmware supports it, plain HTTP never for the product API, rate limits per serial and per address, and the residual risk recorded |
| Secrets (SE-10) | Vendor credentials live in the secret store through `system-administration` integrations; tables hold a key or a hash, never a secret |
| Sensitive use (SE-7) | `biometric:manage`, `attendance:correct`, `breaks:*` reviews and `payroll:*` are sensitive in the registry, so the engine audits each use |
| Logs | Structured, with request, organization and principal ids. Never a payslip amount, a coordinate, or a raw punch line |
| Exports (SE-6, AT-14) | Background jobs; files reached only through short-lived signed links; every export audited |

---

## 17. Gaps to raise with the document owners

Add these to the README's list. The first three block their steps.

| # | Gap | Proposal | Blocks |
|---|---|---|---|
| G1 | No action or route lets an employee punch; `live-status` has no registry actions (README question 3) | §6.4: `status:punch` · live-status · userStatus · people · sensitive no · approval no · — · position yes · delegation yes · SA-only no. §6.5: `POST /api/status/punch` → `status:punch`. Matrix: every employee `own` | Step 4 |
| G2 | Device traffic cannot be a product route: `/iclock/*` paths are fixed by the firmware and devices send no user token | Document a "machine surface" list — beside `/api/platform` and the public identity routes — for `/iclock/*` and `/ingest/biometric/v1/*`, and review the global `biometric_device_directory` table (TN-3) | Step 5 |
| G3 | Shift requests can be decided but not raised or listed | `shifts:request` (shifts · shiftRequest · people · not sensitive · delegable); `POST /api/shifts/requests` → `shifts:request`; `GET /api/shifts/requests` → `shifts:view` | Step 1 requests |
| G4 | `attendance:correct` names only `requestedBy`, so a reviewer can approve a correction to their **own** day raised by a colleague | Also refuse when the approver is the subject, as BM-9 does for breaches through `userId`. This design adds a database check meanwhile | — |
| G5 | `payroll:manage` declares resource `payrollRun`, but `/payroll/payslips/:id/revise` addresses a payslip and `/payroll/structures/:userId` a person; the engine requires the loaded type to match (`engine.ts:155`) | Confirm loading the payslip's run and a subject-keyed run resource, or give those two bindings their own resource | Step 9 |
| G6 | PY-11 posts to a ledger that only arrives in P6 | Posting intents in the publish transaction (D16), turned into journal entries at the P6 cutover (BD-28) | Step 9 |
| G7 | No route for device commands (re-pull logs after an outage, set a clock) or for punch file import | `POST /api/biometric/devices/:serial/commands`, `POST /api/biometric/punches/import`, both `biometric:manage` | Optional parts of step 5 |
| G8 | Corrections have no list route and no reject | `GET /api/attendance/corrections` → `attendance:correct`; a `decision` field on `/corrections/:id/approve`, as geofence appeals do | Step 7 queue |
| G9 | Managers cannot list requests awaiting their acknowledgement (they hold `leave:view` at `own`); optional-holiday claims (HO-1) have no route | `GET /api/leaves/acknowledgements` → `leave:acknowledge`; claims as a leave type | Step 6 |
| G10 | PY-6b says `payroll:view` opens the payroll module — cycle status, aggregate cost — but no route serves that | `GET /api/payroll/cycle` → `payroll:view` | — |
| G11 | BI-4 says skew is measured "at each handshake"; the ZKTeco attendance handshake carries no device time | "Measured on each realtime push, or read from the device where the adapter can" | — |
| G12 | PRD screen paths (`/today`, `/workforce/…`) differ from the client's `/company/…` prefix | Already raised by the access-management design | — |
| G13 | BI-6 reads "same PIN, same device, within 60 seconds". An access controller's entry and exit readers are one device, so taken literally the rule would collapse a real exit into the entry just before it; and because a PIN can pass from one person to another at midnight, it would also collapse one holder's last punch and the next holder's first | Amend to "punches with the same PIN, device, **person and meaning** — entry, exit, a mapped key or a plain scan — each within 60 seconds of the one before, collapse to the earliest of them". This design implements that reading meanwhile (D33) | — |
| G14 | Nothing manages the organization's attendance and shift settings (§6.1, §8.1) or grants a one-day arrival exception (§9.2) | §6.4: `attendance:manage-settings` · attendance · attendanceSetting · people · sensitive yes · approval no · — · position yes · delegation no · SA-only no. §6.5: `GET /api/attendance/settings` → `attendance:view`; `PUT /api/attendance/settings` → `attendance:manage-settings`; `PUT /api/shifts/settings` → `shifts:manage`; `POST /api/attendance/arrival-exceptions` → `attendance:correct`. A row dated in the past also needs `attendance:correct`, as SH-6 does. Until then the go-live seed writes the first rows from HR's answers (Q3, Q6, Q13, Q14) | — |
| G15 | BI-2 says a biometric PIN is unique. The same number legitimately means different people on different systems — a ZK fleet sharing one enrolment list, a separate Hikvision terminal, a vendor cloud | Amend to "unique within a connector, or within one device where a device row narrows it"; the mapping screen warns when one PIN points at different people on two connectors (§10.4) | — |
| G16 | WFH-4 says an approved WFH day "is recorded as present". Read alone, that would pay a WFH day on which nobody worked — TapCRM's mistake (§8.3) | Read it with WFH-3 and AT-12b, as this design does: the day is judged by hours like an office day, so present when the hours are worked and absent when they are not. Confirm, or amend WFH-4 to say so | — |

---

## 18. Decisions needed from HR

Plain questions. The first four block go-live of step 4, because the day cannot
be judged without them.

| # | Question | Old TapCRM | Proposal |
|---|---|---|---|
| Q1 | For each shift, how many worked minutes make a full day, and how many a half day? | 7.5 h full, 4–4.5 h half, the same for every shift (and under 4 h paid as a full day) | HR sets both per shift |
| Q2 | When no break policy exists, is break time paid? | Mixed | Yes — not deducted (D19) |
| Q3 | How long after shift end should a day with no punch-out close automatically? | 4 hours | Keep 4 hours |
| Q4 | Grace before someone is late, per shift? | 59 seconds | HR sets it per shift |
| Q5 | Keep a money penalty for lateness? | 1–2 lates free, every 3 lates = a day's pay, each leftover late ₹200 | Drop it unless a PRD rule is added (D18) |
| Q6 | Must office staff scan the device to start the day? | Intended yes, but not enforced | Yes: `device` arrival for office staff, web only on an approved WFH day or a dated HR exception. Note this **refuses** a web arrival rather than accepting and flagging it, which is stricter than PRD WFH-6's default — confirm that is what you want (D10) |
| Q7 | How old may a device punch be and still apply without review? | 7 days | 72 hours |
| Q8 | Statutory values, and the wage definition under the labour codes | See §14.9 | CA confirms; a named person accepts |
| Q9 | Is the PF wage ceiling scaled by paid days? | Yes | CA decides |
| Q10 | Is overtime paid? | Flag only, over 12 h | Record it (AT-5); pay only if a rule is added |
| Q11 | Week-offs: Saturday and Sunday for everyone? | Yes | Confirm, or give the pattern per department or shift |
| Q12 | From which date does TapIt's attendance count? | — | The go-live date: PIN mappings take effect from it, and nothing earlier is imported (§19) |
| Q13 | Is a night allowance paid, and how? | Nothing | If yes, one method only: an amount per night, or a rate per night hour (often `(Basic + DA) ÷ 200`) applied to the month's night minutes — plus the night window it counts and, for the per-night method, the minimum night minutes that make a day count as a night (§6.6). The CA confirms whether it joins the PF wage base |
| Q14 | Which employees' night assignments need a recorded consent, what is your state's night window, and does the board refuse or only warn without one? | Nothing | HR marks the employees, records consent and transport, board refuses by default (§6.6) |

The leave numbers (BD-5) are already a go-live blocker in the README and are
not repeated here.

---

## 19. Starting on TapIt

TapIt starts clean. Nothing in this design reads from, writes to or waits on
the old TapCRM, and none of its code or data is carried over; it was studied
only to learn what not to do (§1).

1. **Agree the rules with HR first.** TapIt follows its PRD, so some results
   will differ on purpose from what the old system produced — weekends paid,
   short days no longer full days, half-day leave credited correctly, no late
   penalty unless a rule is added. HR signs off the list before go-live.
2. **Enter master data fresh**, through TapIt's own screens and seeds (TECH
   §17.1): shift templates and assignments, holidays and the week-off rule,
   PIN mappings, the device, leave types (accrual 0, LV-12), leave and WFH
   approved from the go-live date, salary structures, and the accepted
   statutory configuration.
3. **Connect the Identix** (§10.9). Attendance counts from the go-live date
   (Q12); punches from before it, which the device resends, find no PIN
   mapping and stay unapplied.
4. **Old history stays where it is.** Importing past attendance or payslips
   from the old system is not part of this design (§21).

---

## 20. Testing

Every numbered rule maps to at least one named test (NF-23). A CI check lists
every AT, SH, LS, BI, LV, WFH, HO, BM and PY id that no test title mentions.

| Level | What |
|---|---|
| Night shifts | A fixed shift with equal start and end times is refused; a 22:00–07:00 shift — the PRD's own acceptance test — and the 20:00–05:00 night used throughout this design, each end to end: one day on the start date with correct lateness and no double counting; the three rotation boundaries in §6.6; half-day leave splitting at 00:30; a holiday and a week-off landing on the shift that starts that date; auto-close at 09:00 the next morning; a device scan at 04:55 landing on the previous date; a shift starting 31 March paid in March; the board showing a night worker as `WORKING` at 02:00 while morning staff are `NOT_IN`; an exit reader finishing the night at 05:04 while an undirected one reads `likely left`; a 13:10 errand scan that does not become the arrival and produces no overtime; first-half leave on a night shift measured across midnight; a Sunday 20:00–05:00 paired with a Monday 04:30–13:30 refused as overlapping; the night allowance paid once, not once per night times the month's hours; `night_minutes` for a 20:00–05:00 shift against a 22:00–06:00 night window is 420, measured across midnight, and a window changed from next month leaves this month's days as they were; a day with eight minutes inside the night window not counting as a night; a 07:30 punch-out staying on the night it closes and a 06:30 arrival belonging to the morning; `WORKING · assumed` after the shift end leaving the working count; a night worker's projection rolling over at 12:31 without a punch; `half_day_minutes = 300` on a 540-minute shift refused or reduced to a reachable half threshold; an access controller with an entry door and an exit door producing `in` and `out` from the same device, both applied even when the exit follows the entry within 60 seconds |
| Unit — pure functions | Shift resolution (one test per chain step), day boundaries (§5.2 cases, SH-I2), attribution (one test per rule, every row of the §5.2 table, and one test where the order decides), `readDay` (every row of the same-second table in §5.3, with ids renamed and the input shuffled to show that neither matters), `closeDecision` (every branch, including "the last scan after the arrival", never the arrival itself), a correction's `in` at 05:30 for a 09:00 shift counting as the arrival although it is outside the window (D36), `calculate` (table-driven; the AT-3 test names the order in its title — AT-I5), the presence state machine, the ADMS parser and handshake builder, every adapter's `parse`, the reading taken when a punch arrives (every direction, and a trusted key the map does not know read as a plain scan), the clock-correction check (the same person, another person, nobody, a person outside their employment), the duplicate rule (a burst ends on its earliest punch in every delivery order; entry and exit never collapse, and neither do two people who held one PIN on either side of midnight), `computePayslip` (golden files: joiner, leaver, mid-month raise, paid and unpaid half-day leave, week-offs, holidays, zero attendance), money helpers |
| Property | Voiding a punch and restoring it gives identical output; a replacement → replacement → void chain leaves no effective event, while a replacement tail is the only effective one; void rows never enter the calculator or presence replay; **for a fixed set of punches, every delivery order and timing — with the hourly auto-close running in between — ends in the same assignments, closures and flags** — punches that share a second and duplicate bursts whose earliest punch arrives last included, for every reader direction but `alternating`, whose out-of-turn scans are flagged instead (§9.1), with the device's settings unchanged while the punches arrive (D37); units always sum to a day; payslip lines always sum to the totals; recalculating twice changes nothing; for any shuffling of a day's events, `rebuild` and an in-order sequence of `apply` calls — `refresh` wherever the fast path's conditions fail, as for two events in one second or an event outside the eligibility window — end in the same state |
| One-reader sites | The rotation case end to end: 20:00 scan, 05:04 scan, 08:50 scan with a 09:00 morning shift — the night is 20:00–05:04 and flagged `previous-session-unconfirmed`, Monday's arrival is 08:50 with assignment reason `next-shift-started` and the board shows it at once, and nothing reads as twelve hours. The same three scans with the next shift a day away keep 08:50 on the night, flagged, with its overtime recorded and not credited until a reviewer confirms it. A web punch-out or exit-reader scan at 07:30 still closes the night |
| Day facts | Changing Monday's start from 09:00 to 08:00 moves Sunday night's `close_due_at` from 09:00 to 08:00 before anything is re-attributed; `refreshDayFacts` runs for D−1, D and D+1 |
| Board agreement | `refresh`, the sweeper, the read path and `/today` return the same day for the same instant: at 07:30 with a session still open it is the night (so a web punch-out is accepted, not refused as an illegal transition), and at 08:50 once Monday has an attributed arrival it is Monday, with the night still open awaiting auto-close — whether that arrival was a scan or the web `in` of someone who never closed the night, and before it `/today` offered both moves; at 06:30 once the morning owns a pulled-forward arrival it is already the morning, half an hour before the geometric boundary; a night row does not read as stale between 07:00 and its `rollover_due_at` |
| Attribution | Everything in an extended session goes with it: with no arrival in between, a night's `break-start` at 07:10, `break-end` at 07:20 and `out` at 07:30 all land on that night, not on the morning. Separately, an `in` at 07:15 — inside the morning's opening window — starts the morning and flags the night `previous-session-unconfirmed`, and every later event is the morning's (a break at 08:55 after an 08:50 arrival, a break at 06:45 after a pulled-forward 06:30 arrival); an `in` that reaches the closing extension — before `openFrom`, with no shift near — joins the open session and is flagged `overlapping-arrival`. Auto-close for that night is due at 09:00, not at the 07:00 geometric boundary, so the 07:30 punch-out arrives before the job. Two identical retries return the same result rather than one of them seeing a unique violation. A `system-close` assignment survives a neighbourhood rebuild. An assignment whose reason changes without changing day still bumps the record. The three answers stay separate: a 07:30 `out` is assigned to the night by the closing extension **and** passes that night's eligibility window; a 13:10 scan is assigned by the midpoint and fails eligibility; a 06:30 `in` is pulled forward to the morning; a 09:05 `out` hits the cap. Voiding the `05:02 out` moves the `07:30 out` from Monday to Sunday and recalculates both; a pinned assignment survives the same change. Two concurrent punches for one person — a 07:30 `out` and a 07:31 `in` — serialise on the advisory lock and attribute as they would in sequence. An `out` and an `in` stamped 07:30:00 close the night and open the morning in whichever order they are delivered, and two `in`s in one second — the web and a reader — land on one day with one reason |
| Late delivery | **The property that matters: for a fixed set of real punches, the resulting days are identical whatever order and timing the pushes arrive in.** It runs as a property test over generated delivery schedules with the hourly job in between, and over the four named cases of §12.4: a late `07:30 out` retires a 05:00 shift-end `auto-out`; a whole night delivered after a `no-show` becomes a night closed at its last scan, its overtime waiting for review; a late `08:30` scan replaces a shift-end guess; a lone late `20:00 in` turns a `no-show` into a flagged shift-end departure with its review item. In each, the retired rows stay readable, `reconciled-from-auto-close` is set, the old review item resolves itself and the new one opens. An `auto-out` is retired at most once, and a day re-derived three times ends with one current closure. A late punch past `closingCap` leaves the day's closure alone; a day closed by a real `out` never gains an `auto-out`. A day inside a frozen payroll period re-derives like any other, and the run's snapshot is byte-identical before and after while the payslip gains its flag and the publish is refused until the item is cleared |
| State machine ownership | A CI check fails the build if a transition table or a `PresenceState` literal is declared outside `packages/contracts/src/presence.ts`, and if `attendance` imports `live-status`; a lint rule fails it too if code in `attendance` or `live-status` sorts attendance events with any comparator but `compareEvents`; `appendEvent`'s refusal and the projector's step agree on every state and kind, because both come from the one `PRESENCE` table: `readDay` walks it, and `apply` takes one step of it, only for an eligible punch in a later second than everything on its day |
| Evidence | Every channel and reader direction stamps the evidence §8.1 lists; a device switched from `alternating` to `exit` leaves its earlier events `assumed`, and replaying a month after the switch gives the same days — punches that arrived before the switch and were still `held` or `unmapped` at it included, each applied with the reading it arrived with; overtime resting on an `alternating` reader's `out` waits for review while the same minutes on an exit reader's `out` do not; the day detail names the reader for every device event |
| Punch route | The route performs no day-dependent check: a 06:30 web punch-in for a 09:00 shift is accepted and lands on the morning, though the caller's row still says last night and that night is `FINISHED`; the same punch from someone with approved WFH **on the morning's date** is allowed from home even though the night's date had no WFH approval; an arrival-policy `device` employee is still refused, with the refusal raised inside the lock against the resolved date, unless an `arrival_exception` covers that person and day, and the policy is the one in force for the department in that day's placement snapshot; a device scan is never refused by the state machine; an illegal move returns 422 listing the allowed moves; a retried `clientEventId` returns the first result without reaching attribution; someone whose night was never closed punches in at 08:50 on the web and is accepted on the morning; an `out` in the same second as the caller's own arrival is refused with 422 and stores nothing, while a web punch-in at 05:30 for a 09:00 shift — outside the eligibility window — is recorded and flagged, not refused |
| Projection safety | A person finishing a night at 07:30 is not rolled to a new day at 07:00 while still clocked in, and once that 07:30 punch-out is recorded the row leaves `WORKING` in the same transaction — rebuilt as Monday's, not yet due — instead of waiting for the 09:00 sweep; a correction to last week, and a device backlog for yesterday, leave today's board untouched; a correction to *today* updates it; a scan on an undirected reader after arrival leaves the person `WORKING · assumed` with the last-seen time, while the same scan on an exit reader finishes the day; an event that moves the person into a new day rebuilds the row instead of advancing the old one, so `work_date`, `shift_start_at`, `window_start`, `window_end` and `rollover_due_at` all move together and the previous day's `FINISHED` never blocks the new day's arrival |
| Halves | First-half leave with work only inside the leave half counts as leave 1 + absent 1, not leave 1 + present 1; work in the complementary half counts; the same on a 20:00–05:00 shift splitting at 00:30 |
| Joiners and leavers | Payroll runs for someone who joined on the 15th and someone who left on the 10th, with no completeness failure and the right not-employed units |
| Publish drift | A salary edited, a bonus added, a payroll input amended or a config version changed during review all stop the publish, each naming the employees to regenerate |
| Concurrency and retries | Two first punches at the same instant create one record; a retried punch with the same `clientEventId` returns the first result rather than a 422, while the same key with a different kind gets 409; two corrections targeting one event — the second is refused, not merged; a publish racing any frozen input is refused; an outbox event delivered twice changes nothing the second time; a `device` arrival policy is not bypassed by a web punch from inside the geofence; an overlapping shift assignment is refused; a duplicate overlay row is refused by the database; two transactions that each touch Alice and Bob — a clock-correction batch and a pair of corrections moving a punch between them — take the locks in ascending user-id order and queue rather than deadlock |
| Recovery | Day-open after a week of downtime leaves no missing day; break evaluation after two hours of downtime still evaluates those days; a stale record blocks a payroll snapshot; a missing day blocks it too; an auto-close that fails every attempt dead-letters, is never re-run by the hourly selector under the same key, comes back as generations 2 and 3 a day apart, then flags `auto-close-failed` and blocks payroll, while a correction on that day starts a fresh key at generation one; a recalculation that dead-letters follows the same path |
| One departure | A double exit swipe at 05:00 and 05:10 is a 05:00 departure: the board finishes at 05:00, the calculator stops worked minutes there, `closeDecision` sees 05:00, and 05:10 is flagged `activity-after-finish`; a `replace-event` moving the departure to 05:10 makes 05:10 the only effective one. On a night-after-night roster, an exit-reader `out` at 10:00 after a 05:00 shift end lands in the night's window but outside its eligibility window, so the shift-end `auto-out` stands and the 10:00 punch is flagged. For every closed day in the property test, the instant `replay` reaches `FINISHED` equals the departure `closeDecision` and the calculator use. An `in` and an `out` in one second give an arrival, no departure and a `same-instant-conflict` review item — on the board, in the calculator and in `closeDecision` alike — and so do a scan and an `out`; at 06:30 after a night that closed at 05:02, the same pair gives the morning its arrival and leaves the `out` on the night as activity after finish; an arrival and a `break-start` in one second start the break at the arrival; a `break-start` and a `break-end` in one second are a zero-length break; an `auto-out` sharing its second with the last event is still the departure. A correction that adds an `out` after the departure is refused with `CORRECTION_NOT_READABLE`, pointing to `replace-event` |
| Integration — real PostgreSQL | RLS on every new table; `UPDATE` and `DELETE` on `attendance_event` fail for the app role; `ux_attendance_event_supersedes` exists and two rows superseding one event fail with a unique violation, both for a correction pair and for two re-derivations racing one `auto-out`; the composite supersession foreign key rejects a nonexistent target and another person's event, and the `CHECK` rejects self-supersession; the evidence `CHECK`s refuse a confirmed scan, a confirmed `auto-out` and an assumed web punch; a correction row that adds a scan, an `auto-out` or an assumed event is refused, while a correction's void row may copy an assumed target and a re-timing row is a system row carrying its approved correction; an `applied` raw punch without its event is refused, and so is any raw punch without its reading, with a meaning its direction cannot give, or that arrived in dry-run and points at an event; the trigger refuses a change to a stored reading; a duplicate linked to another person's punch, to itself, or with no person is refused, and so is a change of person on a punch its burst points at; published payslips refuse changes for every role; overlap constraints; A1 checks in the database; an assignment joining one person's event to another person's day is refused, as are a device event pointing at another person's punch, a correction row under another person's correction, an overlay under another person's leave request or breach, a revision of another person's payslip, and a shift override under another person's request; a second `shift_setting` or `attendance_setting` row for one date, two overlapping arrival-policy rows for one department, an arrival exception granted by its own subject, and a payroll run row without its fingerprint are all refused; an event with a fraction of a second is refused; a raw punch that points at an event without naming its person is refused; two readers of one controller firing for one PIN in the same second store two punches, and so do two vendor events with different ids, while a re-send of any of them stores nothing |
| API — through the router | 403 versus 422 per route; scope per resource; P2, P4, AT-10 and SH-6; subject-keyed loaders |
| Device | An ADMS simulator replays captured Identix traffic: handshake, realtime pushes, a backlog, `.aspx` paths, junk lines, template lines (asserting nothing is stored), wrong serial, wrong IP, a fast clock. Plus the acknowledgement boundary: a storage failure mid-push answers without confirming the count, does not advance the stamp, and the resent push lands every line exactly once. An access-controller simulator: entry reader at 09:00:20 and exit reader at 09:00:45 for one PIN both apply; a double tap on one reader collapses to the first; the same burst delivered in reverse ends on the same punch, the displaced one's event retired by a system void row; a late punch that bridges two bursts retires the later burst's applied event through `retireEvent` although it appends nothing itself; a displaced event a reviewer has already corrected is left alone and a review item opens; a punch that displaces an applied head and is itself appended retires the head in the same step 8, so no `auto-out` appears and disappears in between; two punches of one burst processed at once end with one head; a device's timezone corrected mid-week does not turn its next full-log resend into new punches. Readings kept: a scan that arrived while its reader was `undirected`, waited as `unmapped`, and was replayed after the reader became `exit` applies as an assumed scan, not a confirmed exit, and a `held` one the same; a punch that arrived as `alternating` is still alternated when replayed after the device became `undirected`; a punch that arrived during dry-run and waited as `unmapped` stays `dry-run` when replayed after dry-run is off; the full-log resend after a direction change stores nothing and changes no reading. PIN handover: with PIN 1001 Alice's until Sunday and Bob's from Monday, her scan at 23:59:40 and his at 00:00:20 both apply, each on its own person's day, in either delivery order; a double tap whose earlier punch waited as `unmapped` ends, once that punch is replayed, on it, with the later punch's event retired — what the double tap would have given had the PIN been mapped all along; a double tap straddling the moment dry-run is turned off applies its live punch. Dry-run burst: two dry-run scans at 09:00:00 and 09:00:20 end as `dry-run` and as a `duplicate` linked to the first, and neither creates an attendance event; once dry-run is off, the device's full-log resend and a replay by range change neither result, and had both waited as `unmapped`, replaying them after the PIN is mapped, in either order, gives the same two results. Clock correction: with PIN 1001 Alice's until Sunday and Bob's from Monday, a punch really made at Sunday 23:57 but read at Monday 00:02 through a five-minute offset goes to Bob; correcting the offset does not re-time it on Bob's day — the generic retime never silently keeps the old person — but opens `retime-changes-subject` on both days and holds both people's payroll; the same happens when the new instant has no holder or its holder is outside their employment, and when a mapping edited while the batch waits changes the answer at approval; a correction that only carries a punch across midnight between two of one person's days goes ahead; a punch a person corrected while the batch waited is left alone while the rest are re-timed; the reviewer's void on Bob's day and add on Alice's day, approved together, leave the punch on Alice's day alone, with the raw punch's id in both corrections |
| Regression | Fixture months HR prepares and signs off, run end to end; monthly attendance totals equal payslip totals for everyone (AT acceptance) |
| Load | Board within 3 s at 2,000 employees and 1,200 connections (NF-2); payroll for 2,000 under 3 minutes; a 50,000-line device backlog without slowing the board |

Parser fixtures are the Identix's own traffic, captured on TapIt's device page
during dry-run (§10.9 step 5), so the tests run against what the device in use
actually sends.

---

## 21. Out of scope, with reasons

| Item | Why |
|---|---|
| `performance` and its aggregates (BM-17, WFH-10 reporting beyond the month summary) | P2 module of its own |
| Notification channels and digests | `notifications` is P7; email after commit until then |
| Mobile app | P7; the API above is what it will call, including offline punches |
| More than one timezone per organization | The PRD defines one organization timezone (NF-15, LS-10); device timezones already exist per device |
| Leave accrual, encashment, comp-off accrual | LV-12 ships with entitlements off; the ledger and the `holiday-worked` flag are ready |
| TDS computation | Monthly input line to start |
| Pushing names and PINs from TapIt to devices | Not needed to take attendance; possible later through the command queue |
| Importing history from the old TapCRM | TapIt starts from its go-live date (§19). An import, if the owners ever want one, is a separate one-off design |
| Overtime pay | Q10 |

---

## 22. Revision history

### Revision 23 — step 8 names the head, and a dry-run burst has its test

One finding from the twentieth review — a wording gap and a missing test —
accepted. The review found no other correctness blocker in revision 22.

| Found | Was | Now |
|---|---|---|
| Step 8 read as if every dry-run punch became `dry-run` | "A punch that arrived while its device was in dry-run → `dry-run`" — but step 7 has already made the later punches of a dry-run burst `duplicate`, and the key on `duplicate_of` allows them no other status. §10.9 said such a punch "stays a dry-run punch", and no test followed a two-scan dry-run burst from end to end | Step 8 says what happens to each: the punch that leads its burst becomes `dry-run`, a duplicate stays `duplicate`, and neither creates an attendance event, however late it is replayed. §10.9 says a dry-run punch never becomes attendance. §20 follows two dry-run scans 20 seconds apart through the resend after go-live and a replay (§10.3, §10.9, §20) |

The two-scan burst ran through the pipeline model on time, and again after both
scans waited as `unmapped` and were replayed in either order, with the same two
results each time. On PostgreSQL the document's table accepts a dry-run head
with a `duplicate` linked to it, and refuses `dry-run` on a punch linked to a
head and a dry-run duplicate that points at an attendance event. The checks from
revisions 21 and 22 still pass.

### Revision 22 — a clock correction cannot quietly change whose a punch is

One finding from the nineteenth review, accepted, and what checking it turned
up.

| Found | Was | Now |
|---|---|---|
| A clock correction could leave a punch on the wrong person's day | Step 6 finds a punch's person from the date of its corrected instant, but re-timing after a clock fix wrote the replacement for the same person without looking the PIN up again. With PIN 1001 Alice's until Sunday and Bob's from Monday, a punch really made at Sunday 23:57 but read at Monday 00:02 through a bad offset went to Bob, and fixing the offset moved it to Sunday 23:57 — still Bob's | Re-timing repeats step 6's lookup at each punch's new instant, when the batch is built and again at approval under the locks. The same person: re-timed as before. Anyone else, nobody, or someone outside their employment: not re-timed, and a `retime-changes-subject` item on both people's days holds both payrolls. A reviewer moves the punch with a void on one day and an add on the other, the raw punch's id in both, approved together (D38, §10.6, §12.1, §12.2, §20) |
| Found while checking | Nothing said in what order a transaction that touches several people — a bulk batch, a clock correction, the new pair — takes their locks, so two of them could deadlock. And a single target that a person corrected while a clock-correction batch waited failed the whole batch with `CORRECTION_TARGET_SUPERSEDED` | Every transaction that touches several people takes all their locks first, in ascending user-id order, then record rows (D24, §8.4, §12.1). A clock-correction batch is approved punch by punch: a target a person has since corrected is left alone and named in the answer, and a punch a person corrected before the batch was built is left out (§10.6, §12.1) |

The document's own `attendance_event` and `attendance_correction` SQL ran on
PostgreSQL. A re-timed row can only stay with its person, so keeping Bob was the
only way the old rule could go wrong; the void-and-add pair leaves the punch on
Alice's day alone and cannot be approved by either of them; and two transactions
taking Alice's and Bob's locks in user-id order both finish, while the same two
in opposite orders deadlock. A model of the check reproduced the finding under
revision 21's rule and, under the new one, covered the same person across
midnight, a new instant with no holder, a holder outside their employment, a
mapping edited while the batch waits, and a punch a person corrected meanwhile.

### Revision 21 — a punch is read once, and a burst belongs to one person

Two findings from the eighteenth review, both accepted, and what checking them
turned up.

| Found | Was | Now |
|---|---|---|
| A punch that waited could be read with settings it never had | The direction and the meaning were fixed only when a punch was applied. A `held` punch stopped before the duplicate check and an `unmapped` one before apply, so neither had them, and the schema said both "set once at apply" and "replay reads this, never today's settings" — which cannot both hold for a punch not yet applied. A scan that arrived while its reader was `undirected`, waited as `unmapped`, and was replayed after the reader became `exit` would have come back as a confirmed departure | A device punch is read once, when it first arrives, before anything can hold or park it: its corrected instant, as before (L12), and now its reader's direction (`direction_at_receipt`, replacing `direction_applied`) and its meaning before any alternation, a trusted key through the adapter's new `statusKind`. Both are `NOT NULL`, checked against each other and fixed by the trigger; replay, the full-log resend and an alternating reader's sequence all read them, never today's settings. A punch made before a change but first delivered after it is read the new way, as with a clock offset, and the device screen says when the device was last heard from (D37, D29, §8.1, §9.1, §10.2–§10.4, §10.8) |
| A duplicate burst could join two people | Bursts were judged by device, PIN and meaning before the PIN was mapped to anyone. A mapping is dated, so PIN 1001 can be Alice's until Sunday and Bob's from Monday: her scan at 23:59:40 and his at 00:00:20 were one burst, and Bob lost his first punch. Delivered the other way round, her punch displaced his, and `appendEvent` retired Bob's event while holding Alice's lock | The person is found first (step 6); a burst is one device, PIN and person with one meaning (step 7), and a punch with no person joins one only when it is replayed. `duplicate_of` carries `user_id` on both sides, so the database refuses a burst that crosses people — or a punch that repeats itself — and a displaced head is always the incoming punch's own person, retired under that person's lock (D33, D34, §8.1, §8.4, §10.3, §10.4, G13) |
| Found while checking | Dry-run was also read when a punch was processed rather than when it arrived, so a punch that arrived during commissioning and waited as `unmapped` would write attendance if replayed after dry-run ended, against BI-5, and a dry-run tap seconds before go-live could be the head of a live one and hide it. A trusted key the adapter could not map had no reading. The route that edits a device could not set its direction or its readers | Whether the device was in dry-run is part of the reading; a `CHECK` stops a punch that arrived in dry-run from ever pointing at an event, and dry-run and live punches never share a burst. An unknown key is a plain, assumed scan. `PATCH /api/biometric/devices/:serial` sets the direction and the readers (§9.1, §10.3, §10.4, §10.8, §10.9) |

The changed `biometric_punch` table ran on PostgreSQL with a test for each new
rule. A model of the pipeline reproduced both findings and the dry-run leak under
revision 20's order, showed each one fixed under the new order, and gave the
same result in all 984 ways the punches of a PIN handover and of an
entry-and-exit controller could arrive, with the PIN mapped before, between or
after them.

### Revision 20 — every requirement accounted for, and today's code rechecked

The owner asked to go on. This round checked the design against the PRD
requirement by requirement — all 99 rows of the shifts, attendance, live-status,
holidays, biometric, leave, WFH, break and payroll tables, and each module's
acceptance list — and read §2 against the code as it is now.

| Found | Was | Now |
|---|---|---|
| Six requirements were met but never named | AT-8, BI-1, BM-0b, LV-6, WFH-1 and WFH-5 had no citation, so §20's CI check would have reported them uncovered | Each is cited where the design meets it (§8.3, §10.5, §10.9, §11, §12.1, §13) |
| A registered device could not be commissioned as written | BI-1 accepts pushes only from enabled serials, but §10.9 left the device `pending` while asking the reader to watch its pushes arrive, and §10.5 discarded only disabled devices | A pending device is logged and discarded like a disabled one, and §10.9 enables the device, still in dry-run, before its pushes are watched |
| Two readings of the PRD were decided quietly | BI-2 says a PIN is unique, and this design scopes it to a connector; WFH-4 says a WFH day is present, and this design judges it by hours | Both go to the owners, as G15 and G16 |
| Smaller defects | §13 did not say how BM-13's explanation reaches the employee; §20 called a 20:00–05:00 test the PRD's acceptance test, which is a 22:00–07:00 shift | BM-13 has its row; §20 tests both shifts |
| §2 had drifted from the code | `platform/jobs.ts` now runs four daily maintenance jobs, and the audit jobs write `job_run`; the positions module writes `domain_outbox`; `employee` reaches into other modules six times, not four | §2, §5.4 and §5.6 say what the code does today |

### Revision 19 — a full read, end to end

The owner asked for one more full review. Reading every section again, not
only what revision 18 changed, found these:

| Found | Was | Now |
|---|---|---|
| The night allowance had no stored fact, and pointed attendance at payroll | §6.6 and §14.4 read each day's `night_minutes`, but `attendance_record` had no such column. The night window lived in payroll's configuration, which attendance may not read; the month summary counted night days with a threshold only payroll holds; and §6.6 had payroll read that summary rather than its frozen snapshot (D20) | `night_minutes` is a column the calculator fills from the worked stretches and the night window, now a dated attendance setting. The summary keeps minutes only, and payroll counts nights from the frozen days with its own threshold (§6.6, §8.1, §8.2, §14.9) |
| Settings had no home | The day-start time, the closing extension, the arrival policy, the client-time tolerance, the rest warning, the night windows and day-open's watermark were "organization settings" with no table; §9.2 promised "dated rows" that did not exist; `ResolvedShift` lacked the early window and closing extension that attribution needs | `shift_setting` and `attendance_setting`, dated and owned by the module that reads them; department overrides and one-day exceptions for the arrival policy; a watermark row; two fields on `ResolvedShift`. The routes to manage them go to the owners as G14 (D35, §5.2, §5.3, §6.1, §8.1, §9.2, §17) |
| "A correction can include one when it was genuine" had no mechanism | An event outside the eligibility window was ignored, whoever added it | What a correction adds is eligible wherever it falls, and approval refuses a correction whose punches the day would not read — an `out` in the arrival's second, a punch after the departure (D36, §8.2, §12.1) |
| Two punches of one duplicate burst could both apply | The duplicate check held no lock, so a live push and a backlog job could each find no earlier punch | The check holds a device-and-PIN lock until the punch is applied, and the lock order stays total (§8.4, §10.3) |
| Retiring a displaced duplicate ran the neighbourhood steps twice | `retireEvent` re-derived closures before the new punch was appended, so a day past its cap could gain an `auto-out` and lose it again in one transaction | The punch that is appended retires the old head in its own step 8; `retireEvent` is only for a bridging punch that appends nothing (§4, §8.4, §10.3) |
| `inputs_fingerprint` was described but not stored | §14.4 and §14.6 compare it; `payroll_run_employee` had no column for it | The column exists (§14.1) |
| Smaller defects | The OSH Code paragraph described women's night-work consent (section 43) as if it covered everyone, and quoted state night windows it could not support; L1 described only the default arrival policy; §8.3's `workIntervals` was never defined | The wording is corrected; L1 names both policies; `workIntervals` is the worked stretches of §8.2 step 6 |

Every SQL block ran again on PostgreSQL, with the earlier behaviour tests and
new ones for the settings tables, the arrival exception and the fingerprint.
The rules model gained a check that a correction's punch outside the window is
still the arrival.

### Revision 18 — the same second, duplicates by meaning, one person per link

Three findings from the fifteenth review, all accepted, and the defects found
while checking the fixes.

| Found | Was | Now |
|---|---|---|
| Two events in the same second broke "one departure" | `departureOf` wanted an `out` strictly later than the arrival, while `replay` sorted by time alone: an `in` and an `out` both stamped 09:00:00 gave the calculator no departure and the board `FINISHED` at 09:00. Nothing said which of two same-second events came first, so a tie would have fallen to whichever row id sorted first | One order: by second, then by kind — `out`, `in`, `scan`, `break-start`, `break-end`, `auto-out` — with one kind in one second counted as one piece of evidence. One reading of a day, `readDay`, walks it; arrival, departure, breaks, `replay`, the calculator, `closeDecision`, attribution, the projector's fast path and the punch check all use it. An `out` in the arrival's own second is kept and flagged `same-instant-conflict`; instants are whole seconds, enforced by a `CHECK`; nothing is ordered by id (D32, T-6, §5.2, §5.3, §8.2, §8.4, §9.1, §9.3, §12.3) |
| The 60-second duplicate rule could discard a real exit | "Same PIN, same device, within 60 seconds" collapsed a controller's entry reader at 09:00:20 and exit reader at 09:00:45 into one punch, and the re-send index ignored both the reader and the source's own event id | A re-send is recognised by the source's event id, or by device, reader, PIN, the device's own clock reading and status key — so a timezone fix cannot turn a resent log into new punches either. Punches of the same meaning, each within 60 seconds of the one before, are one burst; different meanings never collapse; the earliest of a burst is kept whatever order they arrive in, a displaced punch's event retired by a system void row. BI-6's wording goes to the PRD owner as G13 (D33, §10.3, §10.4, §17) |
| An assignment could join one person's event to another person's day | Its foreign keys named only the organization and the id | `attendance_event_assignment` carries `user_id`, and both of its foreign keys include it; `attendance_record` gains `UNIQUE (organization_id, user_id, id)`. The same shape now covers every link between two of one person's rows: a device event and its raw punch both ways, correction rows and their correction, overlays and their leave request or breach, payroll inputs and their breach, payslip revisions (D34, §8.1, §10.4, §12.1, §14.1) |
| Found while checking, in the parts the rules model does not cover | The night's own 07:30 punch-out moved the person's current day to Monday, and the board was updated only for the current day, so the row stayed `WORKING` until the 09:00 sweep. The new punch check refused a punch outside the eligibility window, which revision 17 recorded and flagged. Retiring a displaced duplicate's event was written only into `appendEvent`, so a late punch bridging two bursts, which appends nothing, retired nothing. A raw punch with no person skipped its foreign key. The override-to-request key was claimed but not declared. G13's wording read as pairwise | The board is also refreshed for the day its row still describes; step 7 refuses what the state machine refuses, and records an allowed move outside the window with its flag; `retireEvent` is its own operation and leaves a person's correction alone; a `CHECK` closes the gap; the key is declared; G13 uses D33's words (§5.2, §6.1, §8.4, §9.3, §10.3, §10.4, §17) |
| Found while checking: an `alternating` reader depends on arrival order | A scan is alternated when it is applied, so one delivered after later scans is read out of turn — and the delivery-order property quietly did not hold for that mode | Said plainly: such a scan is applied and flagged `alternation-out-of-order` for review, and the property is stated for every other direction (§9.1, §20) |

The rules model now has the order and `readDay`, and checks the same-second
cases (IN + OUT, SCAN + OUT, an arrival and a break, a zero-length break, the
07:30 handover, two channels in one second, an `auto-out` in the arrival's own
second, an `in` and an `out` just after a night closed), that renaming every id
and shuffling the input changes nothing, eight more delivery-order scenarios,
and the duplicate rule — an entry and an exit both kept, a bridging punch
displacing the later head, a burst delivered in any order ending on its
earliest punch. Putting `in` before `out`, or breaking ties on ids, makes it
fail.

### Revision 17 — one departure, what a correction may state, failures that come back

Three findings from the fourteenth review, all accepted.

| Found | Was | Now |
|---|---|---|
| The calculator and the state machine disagreed about the departure | The state machine finishes a day at its first `out`; the calculator took the last. A double exit swipe at 05:00 and 05:10 left the board at 05:00 and paid until 05:10. The same split ran through the eligibility window: the state machine and `closeDecision` read every event while the calculator read eligible ones only, so re-deriving a night's closure could take an exit-reader `out` five hours after the shift as its departure — a 14-hour night | One arrival and one departure per day, from two shared helpers over eligible events: `arrivalOf`, the first `in` or `scan`, and `departureOf`, the first `out` or `auto-out` after it. Attribution's openness test, `closeDecision`, the calculator and `replay` all use them; anything after the departure is evidence, and moving a departure is a `replace-event`. The columns are renamed `arrival_at` and `departure_at`, since `last_out_at` described the old rule (D31, §5.2, §5.3, §8.2, §9.1, §12.3) |
| Correction evidence was stated but not enforced | The database enforced assumed for scans and `auto-out`, confirmed for web and mobile, but not confirmed for what a correction adds — and the payload could in principle add a scan or an `auto-out` | A `CHECK` allows a correction to add only `in`, `out`, `break-start` or `break-end`, always `confirmed`; void rows still copy their target. Re-timing device events after a clock fix, which must keep the scan a scan, becomes its own correction kind whose rows the system writes, linked to the approved correction (§8.1, §10.6, §12.1) |
| A failed auto-close could leave a day open for good | The single key `auto-close:{recordId}` dead-lettered after its retries and the queue then ignored it, so without a new punch the day never closed | Keys carry the input version, and the job runner brings dead-lettered work back by generation — no sooner than a day later, at most three — then flags it for a person; a correction starts a fresh key. Recalculation uses the same rule (§5.4, §8.5, §12.3, §15) |

The rules model was extended to match: it checks that the state machine
finishes at exactly the departure `closeDecision` uses, on every closed day,
and adds the double swipe, the late out-of-window punch-out and the stray
punch-out to the delivery-order property — ten scenarios, 4,000 generated
schedules, all identical.

### Revision 16 — the old TapCRM is a reference, not a dependency

The owner confirmed the scope: the design is for TapIt, and the old TapCRM was
studied only to learn what not to do. Revision 15 still leaned on it in places,
so those are gone:

| Was | Now |
|---|---|
| §19 planned a migration: TapCRM's history imported, a payroll parallel run, a cutover with rollback to TapCRM | §19 is "Starting on TapIt": master data entered fresh, attendance counting from the go-live date (Q12), old history left where it is and listed as out of scope (§21) |
| Seeds, fixtures and defaults came from TapCRM's data: holidays, PIN mappings, a fixture month, parser lines, statutory values | HR supplies holidays and the fixture months; PIN mappings are entered on TapIt's screen; parser fixtures are captured from the Identix during dry-run; the CA supplies every statutory value |
| Q12 asked how long to run payroll in parallel with TapCRM, citing BD-24 | Q12 asks from which date TapIt's attendance counts |
| Two citations, BD-17 and BD-24, pointed at decisions that exist nowhere in TapIt's documents | Checked every requirement id the design cites against TapIt's PRD, TECH and AUTHORIZATION: all 150 others exist. BD-17 is replaced by NF-15 and LS-10; BD-24 went with the old Q12 |
| "V2" and "TapCRM" were used without saying which product is which — confusing in a repository whose PRD calls TapIt by its working name, TapCRM | A **Names** line at the top says what each name means; the design says TapIt throughout, and "the old TapCRM" where it means the old system |

The attendance, shift, biometric and payroll rules are unchanged.

### Revision 15 — final: closures derived from evidence, the next shift wins, evidence recorded

Five findings from the thirteenth review, all accepted, plus what a full
re-reading for the final version turned up. Revision 14's changes are kept.
Its file had passed through an editor that emptied the header row of every
table except its own, so this revision is rebuilt from the revision 13 source
with revision 14's changes applied on top.

| Found | Was | Now |
|---|---|---|
| A late punch still changed the result for arrivals and scans | Only a late *confirmed departure* could retire an `auto-out`. A night delivered after a `no-show` stayed closed with no closing logic applied, and its scan-based overtime came through with no review item because the "not credited" rule lived inside auto-close; a late scan could not replace a shift-end guess. The late-delivery test row asserted a property the design did not have | A closure is derived, not recorded (D25). Attribution ignores system `auto-out` rows, and `closeDecision` runs again whenever a day's evidence changes, retiring an `auto-out` that no longer fits with a void row and writing the new answer. The "not credited" rule moved into the calculator. During this review the rules were run as an executable model: it passes every case in §5.2's table, gives identical days across 2,800 generated delivery schedules, and reproduces the old failure when given revision 14's rules (§5.2, §8.2, §8.4, §12.3, §12.4) |
| Forgetting to punch out of a night blocked the next morning | The closing extension claimed any event up to `closingCap`, an `in` included: a web punch-in at 08:50 was validated against the still-`WORKING` night and refused with 422, leaving "Punch out" as the only button — a confirmed departure that invents 3 h 50 m of overtime. On a two-reader site the entry scan was absorbed into the night and Monday read absent | Any arrival — an `in` from any channel, or a scan — inside the next shift's opening window starts the next day, and once it has started every later event is the next day's (D30). The night is flagged `previous-session-unconfirmed` and its departure goes to review; `/today` offers both moves and leads with starting the shift. `undirected-next-shift` is renamed `next-shift-started`, since it no longer applies only to scans (§5.2, §9.2) |
| Nothing stored whether an event was confirmed | The retraction rule, the overtime rule and the board all depended on it, but nothing recorded it: an `alternating` reader's `out` looked exactly like an exit reader's, and the only other source was today's reader settings, which would let a settings change rewrite history. `biometric_punch` had no `reader_key` column, although §10.4 promised the day detail would name the reader | `attendance_event.evidence`, stamped once, with `CHECK`s that a scan or an `auto-out` is always assumed and a web punch always confirmed; `biometric_punch.reader_key` and `direction_applied`; `evidence` in `AttendanceEventInput` (D29, §8.1, §9.1, §10.4) |
| The attribution rules had no stated order | The rule block read as a list, and §5.2 called the rules "mutually exclusive by construction" — untrue since the undirected override, which overlaps the closing extension; checked in the listed order they would bring back the 08:50 bug. A latent case fell through as well: a break at 06:45 after a pulled-forward 06:30 arrival went back to the night by the midpoint | One ordered list, first match wins: the next day's claim, the day's own claim, the previous session's closing extension, the midpoint. The exclusivity claim is gone, and "the day has already started" is part of each claim, so events after a pulled-forward arrival stay with it (§5.2) |
| Smaller defects | §12.4's check read `first_in_at`, a column the background recalculation fills; §12.3's "last eligible scan … later than every other event" could pick the arrival itself; "a valid one-way chain" did not hold for two rows naming each other in one statement with ids the application supplied; the header date and §0's step 7 were stale | The check went with the special case it belonged to; §12.3 says "after the arrival"; correction and system rows always take database-generated ids, which rules the loop out; header and §0 updated |

Found while re-reading the whole document:

- §6.6 still said a person's current day is "the day whose window holds now";
  it is what `currentDayFor` answers.
- The payroll fingerprint (§14.4) hashed `updated_at` columns that neither
  `salary_structure_line` nor `payroll_input` has; it now hashes the values
  themselves.
- `attributeEvent`'s façade row listed callers that no longer call it.
- The neighbourhood pass now repeats one day further out when an outer day
  gains or loses an event, so a tightly packed roster cannot leave a stale
  assignment beyond the three days.
- The review queue now says how its items are keyed, so a recalculation never
  reopens an item a reviewer has already closed for the same evidence.
- An `out` that lands on a day before its arrival — the `09:05 out` that §5.2
  files on Monday as conflicting evidence — counted as a departure, so it could
  close Monday before anyone had arrived and give a departure earlier than the
  arrival. Openness, `closeDecision` and the calculator now count only an `out`
  after the day's first arrival, and the stray one is flagged
  `departure-without-arrival` for review.
- L5, D21 and D23 were brought in line with closures being derived.
- Every SQL statement in this document was run against PostgreSQL, which found
  two migrations that would have failed: `holiday` and `biometric_connector`
  were targets of composite foreign keys without the `UNIQUE (organization_id,
  id)` such a key needs. Both have it now, as do `biometric_punch` and
  `attendance_correction`, whose keys from `attendance_event` are added in
  steps 5 and 7 — a forward reference the §8.1 notes now state. The new
  constraints were exercised with real inserts: the evidence checks, the
  same-person self-reference, the single retirement per `auto-out`, and the
  effective-event query returning only chain tails.

### Revision 14 — twelfth review: one effective-event rule, a valid supersession chain

Three implementation-definition gaps closed without changing the night-shift
model.

| Found | Was | Now |
|---|---|---|
| The decisions contradicted themselves about payroll freezes | D25 still said a freeze forced a correction, while D27 and §12.4 chose "record attendance, gate the money" | D25 no longer names a payroll freeze as a reason to stop; D27 remains the single frozen- and published-period rule. The stale "two exceptions" wording in D4 and §5.2 was generalised as well |
| "Effective event" was used everywhere but defined nowhere | The calculator said only to drop events a correction superseded or voided, although reconciliation now wrote system void rows; callers could disagree about whether a replacement or a void still counted | D28 and §8.1 define `effectiveEventsOf`: a row is effective only when it is not a void row and no ledger row supersedes it. Attribution, session openness, interactive validation, calculation, projector refresh and auto-close all use that helper, and `AttendanceEventInput` carries effective events only |
| `supersedes_event_id` was unique but not a real reference | The unique index stopped forks, but a row could still point at a nonexistent id, another employee's event, or itself | A same-person composite self-referencing foreign key, the composite unique key it needs, and a no-self-supersession `CHECK`, with integration and property tests for invalid targets, chain tails and void rows |

### Revision 13 — eleventh review: the reconciliation actually runs

Three findings, all accepted. Two were implementation defects in revision 12's
own new section; the third was a policy left half-decided.

| Found | Was | Now |
|---|---|---|
| The reconciliation condition could never be true | The predicate ran *after* the arriving departure was inserted and asked for "exactly one effective departure, an `auto-out`" — but by then the day held two, the assumption and the real punch. It would have failed in precisely the case it was written for | The check is its own step, **before** the write (§8.4 step 8), over `priorDepartures` — the day's departures excluding the arriving event. Step 9 then writes the event, its assignment and the retraction row together, so the day never holds two effective departures even inside the transaction (§12.4) |
| The unique supersedes index was described but never created | §12.1 and §12.4 both leaned on `UNIQUE (organization_id, supersedes_event_id)` to stop two corrections — or two late departures — forking one event's history, but the `attendance_event` DDL created only the user/time and client-event indexes. Prose does not create an index | `ux_attendance_event_supersedes` is in the migration block (§8.1), partial on `supersedes_event_id IS NOT NULL`, with an integration test that two rows superseding one event fail |
| Frozen-period handling mixed two models | Revision 12 said "no automatic retraction, raise a pending correction" while the append flow had already made the punch effective — so a frozen day could show the assumption *and* the real departure, with a correction pending, and nobody could say whether attendance had changed or was waiting | One model, stated as D27: **the punch is recorded and reconciled; payroll is protected by its snapshot, the publish gate and the payslip flag, never by refusing evidence.** It is what corrections to a published period and retroactive leave already do. Holding the punch instead would make attendance deliberately wrong for as long as the queue took to clear, and would be a second contradictory rule (§12.4, §14.4, AT-9, LV-9) |

Two documentation fixes came with them: the façade table listed
`GeofenceFacade.evaluatePunch` as called by `live-status`, and `currentDayFor`
still listed the punch route among its callers — both left over from revision
11, which moved that work into `appendEvent` and took the route out of the
day-resolving business entirely.

### Revision 12 — tenth review: delivery time stops mattering, one state machine

Two findings, both accepted. One was a correctness hole that only opens when a
device is offline; the other was an ownership problem revision 11 created.

| Found | Was | Now |
|---|---|---|
| A late real departure could land on the wrong day | Auto-close wrote a pinned `auto-out`, which closed the session for attribution too. A real `07:30 out` pushed at 09:10, after auto-close, therefore failed the closing extension and fell to Monday — while the same punch delivered at 07:31 belonged to Sunday. Delivery timing changed the result | An `auto-out` closes a day **provisionally**. A confirmed departure at or before `closingCap` still belongs to that day and retracts the assumption through an append-only void row with reason `reconciliation`; the `auto-out` stays readable. Past the cap, against a human decision, or under a payroll freeze it raises a correction instead (§5.2, §12.3, §12.4, D25) |
| The state machine had two possible owners | Revision 11 moved transition validation into `attendance`, but `PRESENCE` was declared in `live-status`, which `attendance` may not import — leaving duplication, a boundary break or a cycle as the only implementations | `PresenceState`, `PRESENCE`, `nextState`, `allowedMoves` and `replay` move to `packages/contracts/src/presence.ts` — pure, no table, no tenancy. `attendance` validates with it, `live-status` projects with it, and CI fails the build if either declares a transition of its own. The projection itself — the row, the confidence fields, the board — stays in `live-status` (§5.3, §9.1, D26) |

### Revision 11 — ninth review: one lock, one day, one live answer

Three findings, all accepted. Revision 10 fixed *where an event belongs*; the
three paths that ask *which day a person is in* were still a step behind it.

| Found | Was | Now |
|---|---|---|
| `currentDayFor` still failed the early-arrival case | The rule started from geometry and only consulted the day *after* it as an afterthought, so a 06:30 punch-in pulled forward to Monday still answered "Sunday" until the 07:00 boundary — the board would show the person as still on last night's shift while they were already working today's | Five steps, in order: geometry, then the **next** day if it already owns an arrival, then this day if it owns one, then the previous day while its session is open, then geometry. The 06:30, 07:30 and 08:50 cases all fall out of it (§5.2) |
| The punch route validated before attribution | The route resolved "the caller's current day", then checked WFH, the arrival policy, the geofence and the state machine against it, and only then called `appendEvent` — which could attribute the punch to a different day entirely. A 06:30 `in` was measured against Sunday's `FINISHED` night and refused, though attribution would have filed it on Monday where it was valid | The route is thin: shape, idempotency, server time, hand off. Every day-dependent check moved inside `appendEvent`, after attribution and under the same per-person advisory lock, evaluated against the **resolved** work date (§8.4 step 7, §9.2) |
| `apply()` was used even when the event switched the live day | The fast path only asked "is this event the latest, with no correction in play" — so an event that moved the person to a new day would advance the *old* day's state machine on a row still holding the old `work_date`, `shift_start_at` and window | `apply` now also requires `user_status.work_date === currentDayFor(now)`. If the day changed, `refresh` rebuilds the row, which is the only path that rewrites the day-describing columns too. `apply` advances a day; `refresh` changes days (§8.4 step 11, §9.3) |

### Revision 10 — eighth review: the current-day rule catches up with attribution

Three findings, all accepted. Revision 9 taught *attribution* about the
one-reader case and left `currentDayFor` and the punch route behind it.

| Found | Was | Now |
|---|---|---|
| `currentDayFor` did not know about the undirected override | "Geometry, extended while the previous session is open" — so at 08:50, with Sunday technically still open, the person counted as in Sunday even though their Monday arrival had just been attributed, and the board would not show them working until auto-close | A four-step rule: geometry, **then** the day the person has actually arrived on wins, then the open-session extension, then geometry again. An attendance day staying open is not the same as the person's current live day (§5.2, §9.3) |
| The punch route still used the geometric window | "Find today's record (the window containing now)" — a 07:30 web punch-out would meet Monday at `NOT_IN` and be refused before `appendEvent` could attribute it to Sunday | The route loads the record from `currentDayFor`, like everything else (§9.2) |
| The new attribution path had no reason of its own | It would have been recorded as `opening-pull-forward`, which means the opposite — that the previous session was closed | `undirected-next-shift` is its own reason, in the contract and the `CHECK`; and the flag wording is fixed so `previous-session-unconfirmed` sits on the **previous** day, where the unconfirmed departure is, while the new day's event carries the reason (§5.2, §5.3, §8.1) |

### Revision 9 — seventh review: one current-day answer, one-reader reality

Three findings, all accepted.

| Found | Was | Now |
|---|---|---|
| Three paths answered "which day is this person in" three ways | The sweeper used `currentDayFor`; the read fallback and `PresenceProjector.refresh` used the geometric window, so the board could flip to Monday at 07:00 while a night was still running | `currentDayFor` is the only answer, called by `refresh`, the sweeper, the read path and `/today`; nothing in `live-status` calls `dayWindowContaining`. `rollover_due_at` — `window_end`, or `closingCap` while an extended session is open — replaces geometric staleness, so a legitimately running night is not swept every five minutes (§9.3) |
| A single undirected reader could swallow the next shift's arrival | An undirected scan never closes a session, so the next morning's 08:50 arrival fell inside the night's still-open session: the night read as twelve hours fifty and Monday lost its arrival | An undirected scan inside the next day's opening window belongs to the next day and flags the previous one `previous-session-unconfirmed`; its departure is the last scan it owns. Directed events are unaffected, and on an ordinary night-after-night roster real overtime still lands on the night. Overtime resting on an unconfirmed departure is recorded but credited only after review, and payroll cannot publish past that item (§5.2, §12.3) |
| `close_due_at` and the windows were not explicitly rebuilt | Recalculation said the snapshot follows the resolver, but `closingCap` depends on the *next* day's shift | One `refreshDayFacts(userId, workDate)` rebuilds shift snapshot, both window edges and `close_due_at`, runs for D−1, D and D+1 **before** re-attribution, and is what day-open calls too (§6.3, §8.5) |

### Revision 8 — sixth review: making the extension consistent everywhere

Seven findings, all accepted. Most of them were the same root cause: revision 7
taught attribution about sessions but left the other users of the boundary on
the old geometry.

| Found | Was | Now |
|---|---|---|
| Auto-close could close a night the model would still accept a punch-out into | `close_due_at` was shift end + window, capped at the geometric `window_end` — 07:00 for a night before a 09:00 morning | `close_due_at` **is** `closingCap`: `min(shift end + max closing extension, next shift start)`, so 09:00. One number now bounds the closing extension, the eligibility window and auto-close (§5.2, §8.1, §12.3) |
| Breaks and scans during extended overtime went to the next day | Only `out` and `auto-out` were extended | The extension follows the **session**: while a day is open, every event up to `closingCap` belongs to it — out, auto-out, break-start, break-end, scan. An `in` there joins the open session and is flagged `overlapping-arrival` (§5.2) |
| Auto-close did not take the person lock | Only the record row was locked | It takes the advisory lock first, like every other writer, and the lock order — person, then rows — is stated once and applies everywhere (§8.4, §12.3) |
| Concurrent retries could hit the unique index instead of the first answer | Idempotency was checked before the lock only | Checked twice: fast path before the lock, correctly under it (§8.4) |
| The SQL would not run in the order written | `attendance_event_assignment` referenced `attendance_record` before it existed | The assignment table is created after the record table (§8.1) |
| `system-close` contradicted the re-attribution rule | Only `correction` was pinned, yet auto-close claimed its event always belongs to the day it closes | `pinned` is a column, true exactly for `correction` and `system-close`, enforced by a `CHECK` (§8.1, §12.3) |
| A reason-only change left provenance stale | Only a change of record counted | An assignment changes when its record **or** its reason changes; both bump `assignment_version` and the record's `input_version` (§8.4) |

### Revision 7 — fifth review: separating window, attribution and eligibility

Revision 6's session-aware exceptions were right in intent and wrong in
structure — they made one window answer three questions. Five findings, all
accepted, and the model is cleaner for it.

| Found | Was | Now |
|---|---|---|
| Attribution and the day window contradicted each other | 07:30 was attributed to the night, then thrown away for being outside that night's window | Three named concepts with three owners: the geometric **day window** (`shifts`), **event attribution** (`attendance`, session-aware, bounded), and the **eligibility window** (not clipped to the day window, may overlap its neighbour). The 07:30 case now works end to end (§5.2, §8.2) |
| `workDateFor` was in the wrong module and had the wrong signature | `ShiftsFacade.workDateFor(userId, instant)` could not tell a 07:30 `in` from a 07:30 `out`, and would have made `shifts` read attendance events | `shifts` keeps `dayWindow` and `resolve`, pure geometry; `attendance` owns `attributeEvent(kind, occurredAt)` and `currentDayFor(at)`. The dependency still points one way (§4, §5.2) |
| Attribution ran before any lock | Two concurrent punches for one person could both read the same session state; the row lock could not help, because the row is unknown until attribution has run | A transaction-scoped advisory lock on the person, taken after the idempotency check and before attribution; recalculation and re-attribution take the same one (§8.4, D24) |
| The owning day was implied by a timestamp | Fine while attribution was pure geometry, not once it was session-aware | `attendance_event_assignment` stores the record and the reason — `midpoint`, `closing-extension`, `opening-pull-forward`, `system-close`, `correction`, `import`. The event stays immutable; the assignment is derived and rebuildable, and the calculator reads events by assignment (§8.1, §8.2, D23) |
| Corrections near a boundary could strand an event on the wrong day | Only the edited record was recalculated | Any change that can alter session openness re-runs attribution across the previous, current and next day, moves only what changes, and recalculates every record that gained or lost an event. Pinned assignments are never moved (§8.4, §8.5, §12.1) |

### Revision 6 — fourth review, night-shift flow

Five findings plus the night-day threshold, all accepted.

| Found | Was | Now |
|---|---|---|
| "Likely left" was a label, not a count | `state` stayed `WORKING`, so live counts were wrong for hours | `likely_finished_at` on the projection; the working count excludes those rows and a "possibly finished" group shows them with the last scan. LS-1's four states are untouched — what changed is what counts as evidence (§9.1, §9.3) |
| Nothing rolled the projection over at a person's own boundary | One row per person held yesterday's `work_date`, `shift_start_at` and `day_group` after a 12:30 night-to-night boundary | The row carries its window; a five-minute rollover sweeper refreshes stale rows from the day `attendance_record` already holds, and a read before the sweeper resolves the day by window anyway (§9.3, §15) |
| Per-reader direction existed in prose only | `biometric_device` had one direction column | `biometric_reader` maps a payload's reader key — `eventaddr`, `doorNo`, a vendor door id — to its own direction, and `NormalizedPunch` carries `readerKey`. A terminal that reports no reader keeps the device-level direction (§9.1, §10.2, §10.4) |
| The midpoint boundary cut real sessions | Geometry alone decided every event | Two bounded, deterministic exceptions: a departure stays with a session that is still open, up to the next shift's start; an arrival within the next shift's early window belongs to the next day when no session is open. 07:30 out → the night; 06:30 in → the morning (§5.2) |
| A half-day threshold could be impossible to reach | `half_day_minutes` was compared against a half that might be shorter | `complementary_half_minutes`, defaulting to `half_day_minutes ÷ 2` — the same standard applied to half the day — refused on save if it exceeds the half; `full_day_minutes` must also fit the shift (§6.1, §6.3, §8.3) |
| One minute in the night window earned a whole night | `night_days` counted any day that touched it | Attendance records night minutes per day; payroll counts a night only when they reach `minimum_night_minutes_for_night_day`, taken from the frozen snapshot (§6.6, §14.4, Q13) |

### Revision 5 — third review, night-shift flow

Five findings plus the allowance formula, all accepted.

| Found | Was | Now |
|---|---|---|
| Equal start and end times became a 24-hour shift | `end <= start` meant overnight | Overnight is strictly `end < start`; equal times are refused with `SHIFT_START_END_MUST_DIFFER`, in the editor and as a database `CHECK` (§6.1, §6.3, §6.6) |
| Overlapping shifts were only refused at write time | Imported or migrated data could still overlap | The resolver flags `shift-window-overlap`, leaves the day unevaluated and sends it to review; payroll stops for that person (§5.2, §6.3) |
| An undirected scan could not finish a night in real time | Readers had a direction, but a single terminal still left the night staff `WORKING` all morning | After the shift end the board reads `likely left 05:04 · unconfirmed`; an opt-in `alternating` mode exists for sites whose people scan both ways, with dedupe and minimum-session guards and every state marked `assumed` (§9.1, §10.4) |
| Half-day leave compared daily totals | A threshold on the day's worked minutes | An explicit interval intersection with the complementary half, written out, with the overnight case — halves that cross midnight — as its own example (§8.3) |
| An off-shift scan could become the arrival | Any event inside the day window was eligible | Each day has an **attendance window** — shift start − early window to shift end + auto-close window. Events outside it are stored and flagged `outside-shift-window`, are never automatically the arrival or departure, and open a review item a correction can act on. A 13:10 errand scan no longer invents fifteen hours on a night shift (§8.2, §6.6) |
| The night allowance formula double-counted | Both night hours and night days in one expression | Two methods, never mixed: amount per night × nights, or rate per hour × the month's night minutes; the conventional `(Basic + DA) ÷ 200` is the hourly rate, and its "night hours" means hours per night (§6.6, Q13) |

### Revision 4 — second review, flow defects

Eleven findings, all accepted.

| Found | Was | Now |
|---|---|---|
| A historical recalculation could corrupt the live board | `rebuild(recordId)` wrote `user_status` for whichever day changed, though the table holds one row per person | The projector takes (person, instant) and writes only when that record is the person's current day; other days recalculate attendance and leave the board alone (§8.4, §9.3, D9) |
| Payroll completeness contradicted day-open | Rows exist only inside employment, but the gate demanded a full period | Expected days are the period **intersected with** the employment window; `not-employed` is kept only for employment changed after the fact (§8.6, §14.4) |
| An undirected scan could never end the live day | `scan` kept the person `WORKING` until auto-close | Readers declare a direction — entry, exit, trusted keys or undirected — and an undirected later scan leaves `WORKING · assumed` with the last-seen time instead of claiming presence (§9.1, §10.3, §10.4) |
| Half-day leave could credit the wrong half | The test used the day's total worked minutes | It measures work in the half that was **not** on leave; work inside the leave half is recorded but buys nothing (§8.3) |
| The publish re-check covered only attendance | Frozen salaries, inputs, employment and config were never re-verified | One `inputs_fingerprint` over the whole frozen set, recomputed and compared inside the publish transaction, with the day versions kept for a precise message (§14.4, §14.6) |
| The boundary anchor reached up to seven days away | A hidden dependency nothing recalculated | The anchor is the assigned template, the department default, then the configured day start — all of which already recalculate their own range (§5.2, §6.3) |
| Overlapping shifts were silently resolved | Boundary fell back to the earlier shift's end | Refused with 422 `SHIFT_WINDOW_OVERLAP`; touching shifts and the 24-hour case still work (§5.2, §6.3, §6.6) |
| Two `UNIQUE` constraints did not constrain | NULLs are distinct in PostgreSQL, so duplicate overlays and scopes were possible | `UNIQUE NULLS NOT DISTINCT` on both (§7, §8.1) |
| A reused idempotency key returned the wrong answer | Only the key was compared | The request's meaning is hashed too: same key with a different request gets 409 `IDEMPOTENCY_KEY_REUSED` (§8.1, §9.2) |
| The PIN-mapping comment claimed something the constraint did not do | "The sentinel prevents coexistence" | Coexistence is intended — a device row overrides the connector row — and a disagreement between them is shown as a warning (§10.4) |
| "Always answer 200" blurred into "always accepted" | The acknowledgement boundary was implicit | Nothing tells the device a line is taken until its raw row commits: the count reflects committed rows and the stored stamp only advances then (§10.5) |

### Revision 3 — night shifts as a first-class case

The product sells into a market where a morning shift and a night shift run in
the same company, so overnight is not an edge case to keep correct in the
calculator and ignore everywhere else. Added: **§6.6**, a walkthrough of a
20:00–05:00 shift through definition, day attribution, rotations between shift
types, the live board, holidays and week-offs, half-days, auto-close, device
punches, the payroll month boundary, night allowance and India's night-work
conditions. Half-days are now defined as halves of the shift (§8.3); the live
projection states that a person's current day comes from their window, not the
calendar (§9.3); the month summary counts night days and hours (§8.1); payroll
counts by work date at a month end and holds the night-allowance method in its
configuration (§14); two questions for HR (Q13, Q14); night-shift tests as
their own row (§20). The "night-shift screens are out of scope" line is gone —
there are no night-shift-only screens, and that is the design.

### Revision 2 — what review changed

A review of revision 1 found eighteen defects. All are accepted; this is where
each one landed.

| Found | Was | Now |
|---|---|---|
| Payroll could publish a stale snapshot | Publish trusted `inputs_changed`, set by an event that can arrive after publish began | The publish transaction re-reads every frozen `{recordId, calculationVersion}` and refuses on any drift; the marker is only a screen hint; `attendance.day-changed` now marks live runs in any state, not just published periods (§14.4, §14.6, D20) |
| Payroll froze only attendance | Salary structures, payroll inputs, employment window and config were read later by parallel workers | The snapshot holds all of them; workers read nothing else (§14.4, §14.5, D20) |
| `device` arrival policy could be bypassed | The geofence branch ran first, so a geofenced office employee could web-punch from inside the fence | Order is WFH → arrival policy → geofence; `device` refuses a web arrival with `ARRIVAL_MUST_USE_DEVICE` (§9.2, D10, Q6) |
| Retry could get a 422 | State was checked before `clientEventId` | Idempotency is step 2, before the state check, backed by the unique index (§9.2) |
| Old client time could become an arrival time | Client time was applied when "fresh", kept and flagged when old | `occurred_at` is always server receipt time; client time is evidence; a gap opens a review item (§9.2, D13) |
| Day boundary broke next to a flexible day | Midnight fallback | A missing start or end borrows an anchor, recorded in provenance; revision 4 replaced the "nearest shift within a week" search with the assigned template, department default, then the configured day start (§5.2, D4) |
| Create-then-lock race on the first event | "Find or create", then lock | `INSERT … ON CONFLICT DO NOTHING`, then `SELECT … FOR UPDATE` (§8.4) |
| Three-day day-open catch-up left holes | Fixed lookback | A per-organization watermark, plus a completeness check before payroll snapshots (§8.6, §14.4, D21) |
| PIN mapping was organization-wide | One PIN per person per organization | Mapping is per connector, optionally per device; one person can hold different numbers on different systems (§10.4) |
| The live projection could not absorb corrections or backlogs | Only incremental `apply` | A rebuild from effective events for anything out of order, with `apply` as the fast path — narrowed further in revision 4 to the person's current day only (§8.4, §9.3, D9) |
| Two corrections could supersede one event | Nothing prevented it | Target-still-effective check under the record lock, plus a unique index on `supersedes_event_id` (§12.1) |
| Break evaluation used a one-hour lookback | The pattern removed from auto-close | Selects closed days whose evaluated version is behind their calculation version (§13, §15, D21) |
| The outbox read as exactly-once | "Treats reprocessing as a no-op" | At least once, stable `event_id`, idempotent consumers stated as a rule (§5.5, D22) |
| History used the current department | No placement history exists | A placement snapshot per day, used by the department fallback and department-scoped holidays (§8.1) |
| Legacy ADMS authentication read as adequate | Serial plus IP allowlist | Preference for an on-site edge agent, tunnel or LAN proxy; the exposed case is listed with its residual risk and compensating controls (§10.5, §16) |
| `payroll_run_employee` had no pre-compute state | `computed`, `failed`, `excluded` | Adds `pending` and `computing` (§14.1) |
| `payroll_input` could take a duplicate deduction | No uniqueness | Typed `break_breach_id` with a unique index per kind (§14.1) |
| Polymorphic references were called foreign-key backed | `(scope_type, scope_id)`, `(source_type, source_id)` | Typed nullable columns with real foreign keys and a `CHECK` that exactly one is set, everywhere (§7, §8.1, §14.1) |
