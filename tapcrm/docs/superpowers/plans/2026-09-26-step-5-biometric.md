# Step 5 — Biometric ingestion: implementation plan

**Status:** prerequisite repair, **5a** and **5b** implemented on 26 September 2026
(uncommitted, see §9 and §10); 5c not started.
**Next work:** 5c once G2 is decided. Before any device goes live: the
overnight leaver rule (roadmap finding 1) and alternation, if a device needs it.
Employment dates are in (§11).
**Design:** [attendance design](../specs/2026-09-22-attendance-shifts-payroll-design.md), §10, D33–D38 and §17.
**Roadmap:** [attendance roadmap](2026-09-25-attendance-roadmap.md).

## 1. Recommendation and scope

Build one durable biometric pipeline, starting with the ZKTeco ADMS adapter
for the Identix. All attendance writes go through `attendance/facade.ts`;
all live updates go through the registered presence projector and outbox.
Do not introduce another presence state machine or write `user_status` from
biometric code.

Deliver this in three reviewable slices, as step 3 was split:

| Slice | Deliverable | Exit |
|---|---|---|
| Prerequisite repair | Reproducible baseline and attendance/projector seams | Existing checks pass; retirement and replacement tests pass |
| **5a-core — foundations (no G2 dependency)** | Tenant tables, constraints, device/mapping management and pure normalization/burst rules | Database invariants and six existing product route bindings tested using tenant-scoped serial lookup |
| **5b — pipeline** | Durable receipt, processing, duplicates, dry-run, replay and recovery jobs | Arrival order, retries and concurrent replay produce the same effective attendance |
| **5c/G2 — device connection** | Global serial directory and bootstrap lookup, ADMS machine router, health, commissioning UI and captured fixtures | G2 resolved; one real device passes dry-run comparison before live activation |

Step 6 (leave/WFH) still depends only on step 3. If the machine-surface
decision or hardware access delays 5c, proceed to step 6 after the buildable
biometric work. **5a/5b and step 6 can continue without G2 or hardware access**:
5b exercises the pipeline through tenant-context services and fixtures. Only
5c needs pre-tenant machine lookup and external machine activation. No need to
wait for web punching to connect a device in dry-run once G2 is resolved.

Other vendor adapters, Security PUSH, edge-agent packaging, file import and
device commands are separate extensions. Do not expose placeholder machine
endpoints for them. Retiming already-applied events needs step 7 corrections;
changing an offset in this step affects new receipts only.

## 2. What the code scan established

The two step-0 groundwork files (the IDE's `Plans/` copy and this folder's copy)
are identical. They describe the platform foundation, not the current milestone.
The implementation has progressed through migrations `0055` and `0056` and
the live-status module. There is no biometric module or biometric migration yet.

| Evidence in the current tree | Consequence for this plan |
|---|---|
| `modules/index.ts` registers shifts, holidays, attendance, live-status, jobs and projector | Reuse the existing composition root; biometric is the next module |
| `live-status/projector.ts` rebuilds from attendance and writes a `live-status.status-changed` outbox row | Use the durable outbox; the step-4 plan's proposed `tx.onCommit` does not exist in `Tx` |
| `attendance/ledger.ts:appendEvent` locks the person, appends, reattributes and refreshes the projector | Device application already has an integration point |
| `retireEvent` reattributes but does not refresh the projector | A bridge punch that only retires a duplicate can leave the board stale; repair before 5b |
| `AppendEventInput` has no displaced-event input; retry lookup only uses `clientEventId` | Add atomic duplicate replacement and device-punch idempotency within attendance |
| Migration `0050` requires a biometric punch id for `source='device'`; its FK is deferred to step 5 | Add the tenant/person composite FK and enforce one original device event per punch |
| `live-status/jobs.ts` emits with team/department saved in the outbox payload | A transfer between commit and delivery can route to the old team; resolve current placement at delivery and test it |
| `live-status/punch-route.ts` is unregistered; its tests mock attendance | G1 is still open. These tests do not establish arrival-policy, WFH or geofence enforcement |
| `attendance/ledger.ts` still describes interactive checks as future work; `location` is unused | Web punching is a separate phase-4 completion item, not a one-line route activation |
| Client has no workforce live board/socket implementation; Vite `/api` proxy lacks `ws: true` | Phase 4 is a server milestone, not a verified end-to-end user feature |
| `attendance/employment.ts` treats active/locked employees as employed on every date | Real joining/leaving dates remain a live-ingestion prerequisite; account status is not an employment history |
| `app.ts` mounts `express.json({limit:'1mb'})` globally before routes | ADMS routing/body handling must precede JSON parsing as well as tenant authentication |
| `AUTHORIZATION.md` already binds all six biometric product APIs to `biometric:manage` / `biometricDevice` | No new product action is needed for the core admin API |
| `platform/jobs`, outbox, time wrapper, rate limiter, tenant DAL and module dependencies exist | Extend these rather than adding parallel infrastructure |
| Email implementation lives under `identity/notifications`, not in a shared platform mailer | Health notifications need a deliberate shared mailer extraction or narrow identity façade; no internal-module import |

This was a repository inventory plus targeted review of roadmap/design,
contracts/authz, migrations, attendance, shifts, holidays, live-status, HTTP,
DAL, jobs, realtime, CI and client wiring. It is not a claim that all unrelated
CRM modules have been audited.

### Baseline verification on 26 September

| Check | Observed result |
|---|---|
| Registry drift | Pass: 147 actions, 307 bindings reported by extractor |
| Architectural gates | Pass: 17 checks, 4 existing phased gaps; scanner reports 63 of 306 manifest bindings implemented |
| Typecheck | Fails: installed tree cannot resolve `socket.io-client` or Luxon declarations; also an implicitly typed socket payload |
| Lint | 16 errors, 49 warnings; errors include inline type imports in attendance detail, unnecessary assertions and unused `DateOnly` |
| `npx vitest run` | 49 files passed, 18 skipped, 1 failed to load; 397 tests passed, 108 skipped. Failed suite cannot load `socket.io-client` |
| Database/Redis integration and NF-2 load test | Not run in this planning scan; skipped database tests are not evidence of passing |

Both missing packages are already declared in the server manifest and lockfile.
Restore the installed dependency tree before deciding whether any manifest edit
is necessary. `npm run ci` initially hit a sandbox IPC restriction in `tsx`;
`node --import tsx tools/ci/index.ts` ran the same gates successfully. Registry
drift was checked through the equivalent `node --import tsx` entry point too.

## 3. Decisions and external inputs

These are tracked dependencies, not evidence that approval has already happened.
They do not block writing tests or preparing the implementation.

| Item | Plan treatment |
|---|---|
| **G2 — machine surface/global directory** | Scope this dependency to **5c**, not 5a-core/5b. The global directory, pre-tenant lookup and machine router ship together after G2 review; tenant schema and the six product APIs use the authenticated tenant's serial lookup and need no global directory |
| G11/G13/G15 | Track the design's proposed BI-4/BI-6/BI-2 clarifications: skew from suitable realtime samples, bursts by person and meaning, PIN uniqueness per connector/device scope |
| Q7 | 72 hours is the design's proposed automatic backfill window, not confirmed HR policy; make it configurable and confirm before live activation |
| Q12 | Obtain go-live date before creating production PIN mappings; no invented employee/device identifiers |
| Employment and midnight PIN transfer | Keep the specified lookup on corrected instant's organization-local calendar date. Do not silently change to attendance work date. Before live activation, resolve the roadmap's overnight leaver/PIN-reassignment edge with fixtures and an explicit policy |
| Historical mapping edits | Forward changes must not remap applied punches. Detect affected historical receipts and expose a review requirement; do not rewrite ownership behind existing attendance |
| Real device | Need serial, model/firmware, sanitized ATTLOG/handshake samples, timezone behavior and allowed office source address before commissioning |

Protocol details below are requirements from the repository design, not fresh
vendor verification. Validate them against the device firmware documentation
and captured traffic during 5c; do not invent fixture provenance.

**Updated burst decision — 26 September review.** Semantic burst identity is
`(organizationId, personId, meaning, dryRunAtReceipt)`, with adjacent corrected
instants at most 60 seconds apart. Device, reader and PIN are provenance, not
partitions. Exact source resends remain a separate uniqueness check. The local
design's D33, §10.3, burst index in §10.4 and G13 still include device/PIN;
this explicit review decision supersedes those portions for implementation.
Do not copy their older grouping, index or lock scope into step 5.

## 4. Prerequisite repair

- [x] Restore dependencies using the existing lockfile. Run typecheck, lint,
  registry check and unit tests; resolve the listed baseline errors in a small
  separate change. Do not weaken lint or skip newly failing tests.
- [x] Run the existing PostgreSQL/Redis integration suite against a dedicated
  database whose name contains `test`, using the established test-role setup.
  The existing CI exclusion for `overrides.integration.test.ts` is a known
  earlier issue; do not extend exclusions to hide biometric failures.
- [x] In attendance, add a narrowly typed optional displaced-device-event input
  to the append operation (or a façade operation composing the same internals).
  Under the person lock: validate same person and `source='device'` origin
  (the physical devices may differ), check whether
  a correction already superseded it, append a system void when eligible,
  append the new device event, reattribute once, and refresh the projector once.
  A device event itself never supersedes: migration `0050` allows that only
  for system/correction rows. Return a structured review outcome if a human
  correction prevents retirement.
- [x] Make standalone `retireEvent` refresh through the projector port, using
  an injected clock's present time. Refactor shared internal retirement so the
  combined operation emits one final projection rather than intermediate ones.
- [x] Add device idempotency by `biometricPunchId`, alongside existing client
  idempotency, with a database unique constraint as the concurrency backstop.
- [x] At status outbox delivery, look up the person's current routing placement
  through live-status's own repository with a tenant context. Missing subject:
  emit nothing. Client payload remains `{userId}`. Test a transfer *after the
  outbox row commits and before it drains*.

**Required tests:** append replacement rolls back as one unit; standalone
retirement changes board state; replacement causes one final status outbox
row; cross-person retirement is refused; human supersession stays intact;
device replay returns the first event; retirement/replay on an old day leaves
the board on the person's current day.

Carry phase-4 web arrival checks, screens, socket reconnect/token refresh and
the 2,000-employee/1,200-connection load test as explicit unfinished follow-ups.
They do not prevent development of the biometric backend.

## 5. Step 5a — schema, admin surface and pure rules

### Task 1 — Schema and database invariants

**5a-core contains only the tenant migration**, provisionally
`0057_biometric.sql`, pure rules, six product/admin APIs and dry-run
configuration. It does not require G2. Product serial lookup is
`(current organization_id, serial_number)` against `biometric_device` under RLS.

**5c/G2 owns the global migration**, provisionally
`0058_biometric_device_directory.sql`, its constrained lookup operation and
`/iclock` activation. Do not include or auto-apply that migration in 5a.
Recheck migration numbers when each slice lands; if G2 is delayed, use the
next available number then rather than reserving 0058 and blocking later work.

Implement design §10.4 tables: `biometric_connector`, `biometric_device`,
`biometric_reader`, `biometric_pin_mapping`, `biometric_punch`,
`biometric_alert`. The global serial directory is Task 7, not this task.
Add durable storage for receipt cursor/Stamp, replay requests/generations, and review reasons where
the design describes behavior but omits columns. Define these in this module;
do not assume the step-7 review/correction tables already exist.

- [x] Tenant tables have RLS + FORCE RLS and explicit grants. Revoke inherited
  broad rights from migration `0001` before granting only needed operations.
  Extend `platform/modules/people-privileges.integration.test.ts`.
- [x] Composite keys bind device to connector, mapping to the correct device
  **and connector**, and punch to device/person/event within one tenant. The
  design's SQL is a starting point: include missing FK declarations, not just
  its illustrative columns. No cross-connector device-specific mapping.
- [x] PIN mapping ranges are nonempty, end-exclusive and exclusion constrained;
  device mapping takes priority over connector-wide mapping. PIN is a string
  so leading zeros survive.
- [x] Retain the three source-resend unique indexes (§10.4), frozen receipt
  fields, same-person duplicate/event links and dry-run checks. Index semantic
  burst neighbors by organization/person/meaning/dry-run/corrected time,
  without device or PIN predicates. Add a partial
  unique index on original device events by organization/punch; system voids
  do not carry the biometric punch id.
- [x] Keep one `biometric_punch` table with a column-specific immutability
  trigger; do not make the entire row immutable. Apply the field rules below
  and deny runtime deletion of receipts.
- [x] Add `biometric_*` to `tools/ci/tables.ts`. All tables introduced in 5a
  remain tenant protected; no RLS exception is added until Task 7.

| Field class | Database rule |
|---|---|
| Frozen after first receipt | Organization, source identity, device/reader/PIN provenance, raw local clock text and safe raw attendance line, occurred/received instants, frozen offset and corrected instant, direction/meaning, dry-run mode, and any mapping-related evidence captured at receipt cannot change |
| Mutable workflow fields | Processing status/reason, attendance-event pointer, duplicate/head relationship, attempts/replay metadata and review disposition may change through valid transitions in the processing transaction |
| Resolved person and mapping evidence | An unmapped receipt may gain its resolved person later. Keep any receipt-time mapping snapshot separate and frozen; preserve later resolution/review history. Once linked to attendance or a burst, an ownership guard plus same-person keys prevents rewriting its owner, including by clearing pointers first; ownership changes require explicit review |

The trigger compares only frozen columns (`IS DISTINCT FROM`), while ordinary
workflow updates remain permitted. Mutable pointers still obey same-person
FKs, dry-run restrictions and valid status/link constraints; “mutable” does
not mean an unrestricted rewrite of history.

**Tests:** migrate from empty and from 0056; cross-tenant FK rejection; scoped
PIN conflict; empty/overlapping ranges; wrong-connector mapping; equal serials
in different tenants work before G2; frozen-column update/delete rejection;
allowed processing-only updates and rollback; unmapped-to-resolved transition;
duplicate across people; dry-run-to-attendance rejection; concurrent inserts
of the same device punch. No directory is needed to run the 5a test suite.

### Task 2 — Contracts, time conversion and frozen reading

- [x] New `modules/biometric/types.ts`, `reading.ts`, `mapping.ts`, `bursts.ts`
  and corresponding tests. Keep adapter/internal types local; put only shared
  admin DTOs in `packages/contracts/src/biometric.ts`.
- [x] Implement `NormalizedPunch`/adapter shape from §10.2. Preserve source
  identity, original local clock text, reader key and status code separately
  from TapIt's corrected instant and interpreted meaning.
- [x] Extend `platform/time.ts` for validated device wall-clock strings with
  **seconds**. Existing `LocalTime`/`instantAt` accepts minute precision only.
  Keep Luxon imports there. Test invalid dates, fractional zones, whole-second
  preservation and explicit handling of ambiguous/nonexistent DST times.
- [x] Freeze offset, corrected instant, direction, meaning and dry-run mode at
  first receipt. Later replay must not read today's device configuration.
- [x] Pure burst grouping uses **organization/person/meaning/dry-run**, with
  adjacent corrected-time gaps of at most 60 seconds and the earliest head
  regardless of arrival order. Search across all devices, readers, connectors
  and PINs resolving to that person. Unmapped punches join only after resolution.
  For equal instants, use stable source provenance as a total-order tie-break:
  reader key, external event id, safe raw line, device id, then PIN (fixed null
  ordering); never receipt row id or ingestion order. Provenance breaks ties
  only; it does not partition a burst.
  Test permutations, equal seconds, late earlier head, and a bridging punch.

| Punches in one organization and dry-run mode | Expected semantic result |
|---|---|
| Device A: X/IN 09:00:10; device B: X/IN 09:00:20 | One burst; A's earlier punch wins in either delivery order |
| Device A: X/IN 09:00:10; device B: X/OUT 09:00:20 | Different meanings; both survive |
| PIN 001: X yesterday; Y today, scans less than 60 seconds apart | Different resolved people; never one burst |
| Different device/PIN/connector, same person/meaning/mode | Same burst when connected by the 60-second chain |
| Same person/meaning, different organization or dry-run mode | Separate bursts |

### Task 3 — Existing product API and resource policy

Create `repository.ts`, `service.ts`, `validators.ts`, `policy.ts`, `routes.ts`,
`errors.ts`, `index.ts` and route/policy integration tests. Register the six
bindings already in `AUTHORIZATION.md`:

| Method | Path | Behavior |
|---|---|---|
| GET | `/api/biometric/devices` | Paginated registry, health and alerts |
| POST | `/api/biometric/devices` | Create/reuse validated connector; device starts pending and dry-run |
| PATCH | `/api/biometric/devices/:serial` | Audited configuration; serial resource loader; no hidden historical retiming |
| PUT | `/api/biometric/mapping` | Dated mapping, scope conflicts and eligible replay count |
| GET | `/api/biometric/punches` | Paginated stream, processing reason and frozen reading |
| POST | `/api/biometric/punches/replay` | Persist bounded replay request; return request id/count |

Use `biometric:manage`, module entitlement `biometric`, and a tenant-bound
`biometricDevice` policy. Model tenant-wide device administration explicitly;
unsupported people scopes fail closed. Test own/team scoped grants as well as
all-people and Super Admin. No role-name checks in handlers. Body-supplied
device/connector/user ids must be resolved within the tenant before mutation.

The action is sensitive and uses framework audit. Explicit response DTOs omit
credentials and biometric material; ensure attendance's ordinary employee DTOs
never gain serials or PINs. Replay does not overwrite an applied punch.

**5a exit:** schema/policy/pure-rule tests pass and APIs can manage dry-run
configuration using tenant-scoped serial lookup. G2, the global directory and
hardware are not required. No production machine exposure or fabricated seed mappings.

## 6. Step 5b — durable ingestion and attendance application

### Task 4 — Receipt and processing transaction boundaries

Create `ingest.ts`, `pipeline.ts`, `events.ts`, and integration fixtures.

1. Validate source and parse allowed attendance data into normalized lines.
2. A receipt transaction freezes readings and bulk inserts source identities
   with conflict handling. Persist a processing outbox signal for new work and
   the accepted cursor/Stamp in the same transaction. A resend leaves original
   readings unchanged. Do not report acceptance before this commit.
3. Process each punch in its own tenant transaction. Small pushes may do this
   synchronously *after durable receipt*; backlogs use jobs. Queue failure must
   not lose the raw receipt or cursor-linked work.
4. Stabilize mapping resolution with a connector/PIN advisory lock (shared by
   connector-wide and device-specific mapping writers), then take the existing
   organization/person advisory lock **before reading burst neighbors**.
   The person lock serializes semantic bursts across devices and PINs; a
   device/PIN lock alone cannot do this. Hold both through application. Lock
   affected rows deterministically. Multi-key operations acquire all mapping
   locks in sorted order, then all person locks in sorted order, then rows;
   never acquire a mapping lock after a person lock. Mapping edits/replay use
   the same discipline and revalidate resolution before linking a punch.
5. Apply future-time/backfill checks; resolve dated mapping and employment;
   compute/reconcile the duplicate burst; honor frozen dry-run; call attendance
   only for an eligible live head. Set `source:'device'`, `remote:false`, frozen
   evidence and punch link. Update only mutable workflow fields in the same
   transaction; no status transition rewrites the frozen receipt.

Use the existing status vocabulary (`received`, `applied`, `duplicate`,
`unmapped`, `dry-run`, `rejected`, `held`) plus structured reasons/review records.
Transient infrastructure failures remain retryable; they are not business
rejections. Raw receipt remains readable even when attendance application fails.

### Task 5 — Burst reconciliation and attendance ownership

- [x] A new earliest head retires its old applied head and appends atomically
  through the attendance operation prepared above. Relink the burst's duplicates.
- [x] A bridge that is itself duplicate retires the later burst's applied head
  without appending another event. The standalone retirement refreshes status.
- [x] A human-corrected head is retained, with a durable review item; do not
  mark a protected effective event as automatically retired.
- [ ] Use the frozen meaning for burst grouping. Alternation, when explicitly
  configured, is resolved under attendance's person lock using the existing
  effective-event/presence helpers through its façade. Do not implement a
  biometric presence table. Add the narrow façade operation needed for this;
  test chronological insertion and out-of-order replay before enabling it.
- [x] Device default is undirected/assumed. Entry/exit/trusted keys produce the
  design's confirmed meaning. A replay on a past day must not move today's
  board backwards.
- [x] A chronological employment façade must replace the status-only shim
  before live production application. Keep fixture-backed dry-run development
  possible while that prerequisite is unresolved.

**Required integration cases:** all arrival permutations of a chained burst
spanning devices/PINs/connectors; two devices with the same person's IN within
60 seconds collapse; cross-device IN+OUT both survive; changed PIN owner at
midnight never shares a burst; two readers same second retain distinct source
receipts but collapse only when person/meaning/mode match; equal-time heads
are stable across delivery order; different tenants and dry-run/live modes
stay separate; concurrent processing on different devices for the same person
produces one semantic head; processing-only updates pass the immutability guard;
held/unmapped replay keeps old timezone/direction/mode; new timezone followed
by full-log resend creates no second receipt; transaction rollback leaves no
event, pointer or status notification half-written; concurrent push and replay
produce one head; correction prevents silent retirement; five-minute-fast
device corrected by offset produces expected attendance lateness.

### Task 6 — Replay, recovery and health

Create `replay.ts`, `jobs.ts`, `health.ts` and job integration tests.

- [x] Replay request is bounded by tenant and validated ids/PIN/date range;
  persist selection/progress and reason. Applied rows are skipped. Explicit HR
  replay can release the age hold, but cannot bypass dry-run, employment,
  mapping ownership or invalid timestamps.
- [x] Use `defineJob` + transactional outbox. Key automatic processing by punch
  and generation; explicit replays use a new persisted request/generation.
  Reusing a completed punch key would be suppressed by the existing runner.
- [x] Sweep stranded `received` rows and unfinished requests in bounded pages,
  recover from Redis downtime/worker death, and expose terminal job failure for
  retry/review. Acknowledged receipt must always have a recovery path.
- [x] Every 15 minutes, check silence while mapped people's resolved shift
  windows are open; 60 minutes without contact opens one alert. Poll contact
  counts and later valid contact resolves silence. Track skew only from samples
  identified as suitable realtime evidence; backlog age is not clock skew.
- [x] Alerts emit `biometric.device-alert` after commit, with deduplication.
  Route email through a shared mailer or narrow façade and recipients selected
  by effective `biometric:manage` permission, not hardcoded HR role names.
  Test using a fake sender; implementation tests send no real notifications.

**5b exit:** replay/concurrency/crash tests pass on real PostgreSQL and Redis;
receipts are durable, effective attendance deterministic, and projector/outbox
stay consistent. Auto-close reconciliation and approved historical retiming
remain step-7 dependencies, explicitly absent from this exit claim.

## 7. Step 5c — machine router, operator UI and real device

### Task 7 — Dedicated ADMS machine surface (G2)

This task owns the global directory migration (provisionally `0058`; select
the next free number at implementation), independently of 5a-core/5b:

- [ ] Add `biometric_device_directory` with a globally unique serial and only
  tenant/device identity. Preflight existing tenant devices for cross-tenant
  serial collisions before backfill; report conflicts for resolution, never
  pick a tenant automatically. Until resolved, machine activation stays off;
  the tenant product API remains available.
- [ ] Synchronize directory changes transactionally through a constrained
  trigger/function. Test runtime grants, tenant checks and fixed search path;
  do not copy the identity directory's broad write grants.
- [ ] Add the reviewed directory RLS exception to `tools/ci/index.ts` and
  `.github/workflows/ci.yml` together. Test global collision refusal, backfill,
  synchronization and minimal pre-tenant lookup; other tables retain RLS.

Create `machine-router.ts`, `machine-auth.ts`, `adapters/zk-adms.ts`, parser
fixtures and HTTP integration tests. Add a named, parameterized
`bootstrapDb.lookupBiometricDevice(serial)` operation: it returns directory
identity only, not an arbitrary privileged SQL facility.

- [ ] Mount at `/iclock` before global JSON parsing and before product tenant
  authentication, while retaining request IDs/security headers. Authenticate
  serial, enabled tenant/module, enabled connector/device, and source IP before
  accepting payloads. Construct a tenant service principal with no product
  actions; use ordinary RLS-bound `db` for all subsequent work.
- [ ] Honor the design's cdata/handshake, ATTLOG, operation log, poll and
  housekeeping behavior, including case-insensitive `.aspx` suffixes. Normalize
  only the intended machine paths; product routes retain their own handling.
- [ ] Machine-local bounded body/error handling must return the ADMS text
  protocol for parser/size/internal errors too. Do not let JSON middleware,
  generic error handler or proxy return an HTML/JSON failure response.
- [ ] Bound raw body to 5 MB, rate-limit by source IP and serial, and validate
  trusted proxy behavior. `app.set('trust proxy', 1)` alone is not proof an
  arbitrary forwarded address is trustworthy in the deployment topology.
- [ ] Process only an allowlist of attendance fields. Discard photo/template/
  user payloads without persisting or logging their bodies; privacy alerts
  contain identifiers/counts, never the material. Sanitize malformed-line logs
  and fixtures; do not blindly persist an arbitrary `raw` fragment.
- [ ] Unknown/disabled serial: metadata-only logging, no auto-registration,
  attendance receipt or options disclosure. Protocol response follows §10.5.
- [ ] `OK: <count>` represents durably accepted lines, including verified
  resends whose original row is committed; rejected parsing lines do not
  inflate it. Failure before receipt commit returns no accepted count and
  advances no Stamp. Pin count semantics with actual firmware resend tests.
- [ ] Handshake/timezone output and HTTP Date behavior follow the validated
  fixture. Start with resend-all; resume is opt-in only after crash/recovery
  tests establish safe cursor advancement.

**HTTP tests:** wrong Content-Type still parses ATTLOG; mixed valid/invalid
lines; malformed/oversized bodies; unexpected tables; unknown serial; spoofed
forwarding; disabled organization/module; rollback and ambiguous commit;
committed resend; no biometric bytes in DB/logs; service principal cannot call
product routes. Test through `buildApp`, not just the parser.

### Task 8 — Operator screens and commissioning

Add client `biometric/` API/types/pages following existing company workspace,
navigation and permission patterns. Wire `/company/workforce/biometric` with
registry, device configuration, mapping and punch-stream tabs. Use existing
`biometric:manage` metadata, server-authoritative validation, pagination and
clear dry-run/held/unmapped/review status. Configuration/replay uses only the
six registered APIs; do not invent extra resource routes.

Before changing a real device's server, record the current destination and
make the commissioning changes reviewable. Collect sanitized real samples;
verify handshake timezone and clock; compare one day of dry-run receipts to
the terminal log; confirm mappings, employment dates, backfill and go-live
date. Then explicitly activate live mode. Old dry-run receipts stay dry-run
even if the device resends them. Document rollback to dry-run and the previous
device destination without deleting receipts.

**5c exit:** captured-payload BI acceptance suite passes; unregistered devices
are refused; no biometric material is stored; health and replay are usable;
device-to-attendance-to-status is verified. Record firmware and capture date.
Full board NF-2 performance still needs the separate browser/socket client and
representative load test; backend tests alone do not establish it.

## 8. Validation and completion record

For each task, write behavioral tests, observe the missing behavior, implement,
then run the relevant suite. Leave changes uncommitted for review, matching
the earlier implementation plans.

From `tapcrm/`, final checks after restoring dependencies:

```bash
npm run registry:extract -- --check
npm run typecheck
npm run lint
npm run ci
npx vitest run
```

Then use the existing CI test-database setup and run the full integration
suite with `TAPCRM_INTEGRATION_DB=1` (retaining only its documented pre-existing
override-test exclusion if still necessary). Verify RLS with the runtime role,
not only with the migration owner. Include migrations from empty, from 0056,
concurrent processing and outbox rollback/delivery tests.

Record separately: automated checks, G2 status, unresolved HR/employment
decisions, real-device fixture evidence and load-test evidence. Mark each
slice complete independently; do not label all of step 5 done because a parser
accepts synthetic lines.

**First implementation batch:** dependency/baseline repair, attendance atomic
replacement + retirement projection, delayed status routing test, then 5a
tenant schema and pure-rule tests. This is the concrete next step.

## 9. What changed while implementing (26 September)

Prerequisite repair and 5a are in the working tree. Checks, run on a copy with
the lockfile's packages installed and a PostgreSQL/Redis test database:
typecheck and lint clean, `npm run ci` 17 passed (CI-2 now 69 of 306 bindings,
CI-10 15 of 63 policies, CI-33 62 tables), registry in sync, the app boots,
and the whole suite with `TAPCRM_INTEGRATION_DB=1` passes 589 tests. The only
failures are the two known ones in `access-management/overrides.integration.test.ts`.
Migrations run from empty and from 0056.

The 16 lint errors and the typecheck failure seen in the planning scan come from
the local install missing `socket.io-client` and Luxon's types. With the
lockfile's packages installed, both pass with no code change: run `npm ci`
locally.

Decisions taken while building, where the plan left room:

- **Migration numbers.** `0057_attendance_device_punch.sql` is the prerequisite:
  one event per device punch, as a partial unique index. `0058_biometric.sql`
  is 5a. The global directory (Task 7) takes the next free number.
- **Replacing a head is its own façade operation,** `replaceDeviceEvent(tx,
  displacedEventId, input)`, not an extra input on `appendEvent`. It returns
  `{ outcome: 'appended', … }` or `{ outcome: 'refused', reason }`, where the reason is
  `other-person`, `not-a-device-event` or `already-superseded`. Nothing is
  appended when it refuses. `appendEvent`, `replaceDeviceEvent` and
  `retireEvent` share one void step and refresh the board once, at the
  present time.
- **A punch delivered again returns its first event even after that event was
  retired.** The earlier draft skipped retired events, which would have
  appended the punch a second time (and now hits the unique index).
- **Live status rows carry only `{ userId }`.** The handler looks up the
  person's team and department when it delivers, in a tenant context, and
  sends nothing for a person who is gone.
- **The key from `attendance_event` to `biometric_punch` is `NOT VALID`.**
  It checks every new row. Device rows written before 0058 can only be test
  data (the step 3 fixture month left some in test databases). Run `VALIDATE
  CONSTRAINT` once a database has none. The attendance tests now create the
  raw punch a device event names.
- **Extra columns the design omits:** `attlog_stamp` and `operlog_stamp` on the
  device (receipt cursors), `pin_mapping_id` and `processing_generation` on the
  punch, and three new tables: `biometric_replay_request`,
  `biometric_review_item` and `biometric_alert`. Only one alert of each kind can
  be open per device, and only one review item of each kind per punch.
- **Who owns a punch.** A trigger refuses any change to the reading. Once a
  punch has an event, its event, person and mapping cannot change, even by
  clearing the event pointer first. Once it is in a burst, it cannot leave
  the burst or change person. The app role cannot delete punches.
- **Device clock readings** (`platform/time.ts`): a reading the clock shows
  twice, in the hour the clocks go back, takes the first instant and is
  flagged `ambiguous`. A reading that never exists, in the hour the clocks go
  forward, is refused rather than moved.
- **Admin API.** All six routes need `biometric:manage` for the whole
  organization. A grant limited to a team or department is refused (403), for
  every route. Super Admin is allowed.
  - A PUT for the same scope, PIN, person and start date changes that row's
    end date. Anything else adds a new row.
  - If the PIN is already taken for one of those days, the answer is 409 and
    names who has it. The PIN changes hands when the old row is ended.
  - Punches already given to someone else are never moved. They are opened
    for review, and the answer counts them in `needsReview`.
  - A replay request is saved and counted, but nothing processes it yet; the
    replay job comes with 5b (Task 6).
- **Live mode stays off.** `PATCH … { dryRun: false }` answers 409
  `BIOMETRIC_LIVE_NOT_AVAILABLE`. Switching it on needs the machine surface
  (5c) and real employment dates. It is one constant in `biometric/service.ts`.

Still open before 5b: nothing blocks it. The Q7 backfill window is the
device's `backfill_hours` (default 72) until HR confirms it.

## 10. What changed while implementing 5b (26 September)

5b is in the working tree. Same checks as §9: typecheck, lint, `npm run ci` (17
passed) and the full suite with `TAPCRM_INTEGRATION_DB=1` pass 614 tests; the
only failures are the same two in `overrides.integration.test.ts`. The app
boots with the new jobs registered.

What was built, in plain terms:

- **Receipt** (`ingest.ts`): one transaction does four things: it stores
  every line with the reading taken as it arrives, moves the device's cursor,
  marks the device as heard from, and writes the processing signal to the
  outbox. A resend is counted as accepted and changes nothing. A device that is
  not enabled is heard, but nothing it sends is kept (BI-1). A push of ten
  lines or fewer is processed straight away; a failure there only leaves the
  punch for its job.
- **Processing** (`pipeline.ts`): each punch is processed in its own
  transaction, taking the PIN lock, then the person's lock, then the rows. It
  checks, in order:
  - a punch more than 5 minutes in the future is refused;
  - one older than the device's backfill window is held;
  - it finds the PIN's owner on the punch's own date;
  - it refuses a person who is not employed, and opens a review;
  - it places the punch in its burst;
  - it writes to attendance through `appendEvent`, `replaceDeviceEvent` or
    `retireEvent`.

  Punches that arrived in dry-run are grouped into bursts the same way, but
  never become attendance.
- **Protected heads:** when a person has corrected a head's event, the head
  stays applied. An earlier punch becomes its duplicate, marked
  `protected-head`, and a review item is opened.
- **Replay and recovery** (`replay.ts`, `jobs.ts`):
  - A replay request runs one page at a time and records how far it got, so a
    run that dies picks up where it stopped. Applied punches are never picked.
  - Every 5 minutes a sweeper looks for punches still waiting a minute after
    they arrived, and for requests still open, and queues them again.
  - A punch whose three tries all fail is held with the reason
    `processing-failed`. A request that fails the same way is marked failed.
- **Health** (`health.ts`), checked every 15 minutes:
  - **Silence:** a device not heard from for 60 minutes, while someone it
    serves is on a working-day shift, opens one `silent` alert. Any contact
    ends it.
  - **Skew:** measured only from realtime pushes carrying one new line, as the
    median of the last 20 samples (migration `0059`). An alert needs at least
    three samples; over 3 minutes opens `skew`; near a whole half hour opens
    `timezone-suspect`.
  - **Mail:** each alert is emailed once, through a new narrow identity
    function (`sendBiometricDeviceAlert`). It goes to everyone holding
    `biometric:manage` for the whole organization, found through a new
    access-management façade (`capabilityHolders`).
- **Acceptance:** `packages/server/src/acceptance/` holds one cross-module
  test. A device five minutes fast, with its offset set, records the arrival
  at the true time and no lateness; without the offset, the same arrival
  shows as three minutes late. The test sits outside any module so that it
  can use attendance's calculator directly.

Decisions:

- **Plausibility is judged against the moment the punch arrived,** not when
  it is processed, so a slow queue cannot turn a fresh punch into a held one.
- **A job that finished but left its punch waiting** is treated like one whose
  tries are all spent: the punch is held for a person.
- **Silence ignores week-offs and holidays,** using the holiday calendar, and
  counts only fixed shifts; flexible shifts have no hours to check against.

Still open (the unticked items in Task 5):

- **Alternation:** an alternating reader's scans stay plain scans until someone
  turns alternation on and it is tested.
- **Employment:** the employment check is still the account-status stand-in,
  not real joining and leaving dates.

Both must be done before any device goes live. Live mode is still switched off
in `biometric/service.ts`.

## 11. Employment dates (26 September)

Task 5's last item is done: `AttendanceFacade.employedOn` now answers from
the joining and leaving dates (migration `0060`, roadmap finding 6), not from
the account status. The dates alone decide, so a punch replayed a month later
is judged exactly as it would have been on the day. The account status only
stops new days being opened for a deactivated account with no leaving date.
A punch after the leaving date is refused with the reason `not-employed` and
a review item; the pipeline test covers the leaving day and the day after.

Still open before live: the overnight rule in roadmap finding 1. A night worker's
punch-out after midnight on the morning after their leaving date is refused,
because employment is checked on the punch's own calendar date. HR needs to say
which of these should happen: check employment on the day the shift belongs to,
allow a short grace after midnight, or leave it for review as it is now.
