# Step 7 — Corrections, Auto-Close and Reconciliation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the individual correction and auto-close core of §12, with deterministic closure re-derivation and a real PostgreSQL gate. This plan does **not** close all Step 7 roadmap obligations; the named follow-up work is listed below and must remain open in the roadmap.

**Architecture:** Three interlocking pieces: (1) pure `closeDecision`, using the eligibility window and the actual shift end as separate inputs; (2) `applyCloseDecision`, which applies a changed answer to open **or closed** records and writes append-only system rows; (3) an individual correction workflow under the person's advisory lock. Every writer re-derives all days changed by attribution. AT-10 is a privileged authorization constraint evaluated against the organization's local calendar date. Bulk creation groups pending corrections; atomic batch approval remains a separately tracked roadmap obligation.

**Tech Stack:** TypeScript, PostgreSQL, Zod, Vitest, `@tapcrm/authz` (`authorize`, `registerConstraint`, `PASS`, `DENY`), `@tapcrm/contracts` (`readDay`, `compareEvents`, `DateOnly`, `EligibilityWindow`)

**Execution rule:** Do not mark this plan complete from unit tests alone. The PostgreSQL fixture must use the real `sql`/`db` APIs, real employee principals and position grants, and the mandatory integration command below. Do not run the final `git add -A` in this working tree; stage only the files this plan changes.

**Authorization split:** The existing registry marks `attendance:correct` as
approval-bearing. The router passes no resource on the raise and bulk routes,
so A1 denies them before their handlers run. Add a non-approval-bearing
`attendance:raise-correction` action for creation; reserve
`attendance:correct` for approving a loaded pending correction. A dated
resource in the service still enforces scope and P9 for creation.

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `team-docs/security/AUTHORIZATION.md` | Modify | Source registry: split raising a correction from approving one |
| `packages/contracts/src/registry.generated.ts`, `seeds/registry.seed.json` | Regenerate | Bind raise/bulk to the new non-approval-bearing action |
| `migrations/0062_corrections.sql` | Create | `attendance_correction` + same-org FKs + `attendance_review_item` with correct resolution schema and unique indexes |
| `packages/server/src/platform/modules/people-privileges.integration.test.ts` | Modify | Pin SELECT/INSERT/UPDATE and revoked DELETE for both new People tables |
| `packages/server/src/modules/attendance/close.ts` | Create | `closeDecision` pure function |
| `packages/server/src/modules/attendance/close.test.ts` | Create | Unit tests for `closeDecision` |
| `packages/server/src/modules/attendance/repository.ts` | Modify | Correction/review helpers, `findRecordForClosure`, and `setRecordClosure` for derived changes on closed days |
| `packages/server/src/modules/attendance/day-facts.ts` | Modify | Expose the actual fixed-shift end separately from eligibility/closingCap |
| `packages/server/src/modules/attendance/day-facts.test.ts` | Create | Distinguish fixed shift end from the later closing cap |
| `packages/server/src/modules/attendance/ledger.ts` | Modify | Add `applyCloseDecision`; re-derive every touched day after every ledger attribution path |
| `packages/server/src/modules/attendance/recalculate.ts` | Modify | Re-derive closures when refreshed facts or closingCap change |
| `packages/server/src/modules/attendance/jobs.ts` | Modify | Hourly scan and item job using Step 0's bounded generations; exhausted review item in a successful scan transaction |
| `packages/server/src/modules/attendance/errors.ts` | Modify | Add `CORRECTION_NOT_FOUND`, `CORRECTION_TARGET_SUPERSEDED`, `CORRECTION_NOT_READABLE`, `INVALID_CORRECTION_STATUS`, `CORRECTION_TOO_OLD`; add `AttendanceForbiddenError`, `AttendanceUnprocessableError` |
| `packages/server/src/modules/attendance/events.ts` | Modify | Define `correction.decided` outbox event for notification consumers |
| `packages/server/src/modules/attendance/validators.ts` | Modify | Add discriminated-union correction schemas; **no** `retime-device-events` |
| `packages/server/src/modules/attendance/policy.ts` | Modify | Add `attendanceCorrectionPolicy`; register AT-10 as a `kind: 'privileged'` constraint |
| `packages/server/src/modules/attendance/correction.ts` | Create | Raise/request/approve and grouped bulk creation; atomic batch approval remains open |
| `packages/server/src/modules/attendance/correction.test.ts` | Create | Dated authorization and A1/G4 service tests |
| `packages/server/src/modules/attendance/routes.ts` | Modify | 4 correction routes; approval loader supplies A1/P9 evidence, creation service enforces dated subject scope |
| `packages/server/src/modules/attendance/correction.integration.test.ts` | Create | Mandatory PostgreSQL integration gate (no `skipIf`) |

---

### Task 0: Split correction creation from approval in the registry

**Files:** `team-docs/security/AUTHORIZATION.md`, generated registry and seed.

- [ ] Add `attendance:raise-correction` to the action table with module
  `attendance`, resource `attendanceCorrection`, people domain, sensitive
  `yes`, approval-bearing `no`, initiator field `—`, position grantable
  `yes`, delegation `no`, Super-Admin-only `no`.
- [ ] Change the POST `/api/attendance/corrections` and
  `/api/attendance/corrections/bulk` rows to this action. Keep
  `/corrections/:id/approve` on `attendance:correct` and the employee
  `/corrections/request` route on `attendance:request-correction`.
- [ ] Run `npm run registry:extract`, then
  `npm run registry:extract -- --check`. Do not edit either generated
  file by hand. Migration 0062 must copy each existing
  `position_policy` grant for `attendance:correct` to
  `attendance:raise-correction` with the same `allowed`, `scope`,
  `fields` and `constraints` unless that position already has an
  explicit raise policy. Seeded test positions need an explicit raise
  grant too. This preserves existing correctors' ability to propose
  while allowing future roles to grant proposal without approval.
- [ ] Add the route-level proof to Task 9 after the routes exist:
  raise/bulk reach their handlers under the proposal action, while
  approval without a loaded `requestedBy` fails closed under A1.
- [ ] Commit only the registry source and outputs:

  ```bash
  git add team-docs/security/AUTHORIZATION.md packages/contracts/src/registry.generated.ts seeds/registry.seed.json
  git commit -m "feat(attendance): separate correction proposal from approval action"
  ```

---

### Task 1: Migration 0062

**Files:**
- Create: `migrations/0062_corrections.sql`
- Modify: `packages/server/src/platform/modules/people-privileges.integration.test.ts`

- [ ] **Step 1: Write the migration**

```sql
-- =====================================================================
-- 0062 — Corrections, auto-close and reconciliation (design §12)
-- =====================================================================

-- The registry split keeps approval-bearing attendance:correct for decisions.
-- Existing correctors retain proposal access at their current scope; an
-- explicitly configured raise policy wins over this backfill.
INSERT INTO position_policy
  (organization_id, position_id, action, allowed, scope, fields, constraints)
SELECT organization_id, position_id, 'attendance:raise-correction',
       allowed, scope, fields, constraints
FROM position_policy
WHERE action = 'attendance:correct'
ON CONFLICT (organization_id, position_id, action) DO NOTHING;

CREATE TABLE attendance_correction (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  user_id         uuid NOT NULL,
  work_date       date NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('add-event', 'replace-event', 'void-event',
                                                'confirm-as-is')),
  payload         jsonb NOT NULL,
  reason          text NOT NULL CHECK (char_length(reason) >= 20),
  batch_id        uuid,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by    uuid NOT NULL,
  decided_by      uuid,
  decided_at      timestamptz,
  decision_note   text,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, user_id, id),
  -- Same-org FKs (D34): every participant must belong to this organization.
  FOREIGN KEY (organization_id, user_id)       REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, requested_by)  REFERENCES app_user (organization_id, id),
  CHECK (decided_by IS NULL OR decided_by <> requested_by),   -- A1
  CHECK (decided_by IS NULL OR decided_by <> user_id)         -- nobody corrects their own day (G4)
);
-- decided_by FK added separately: the column is nullable so the FK holds only when non-null.
-- Postgres enforces nullable FKs correctly (NULL values never violate FK constraints).
ALTER TABLE attendance_correction
  ADD CONSTRAINT fk_attendance_correction_decided_by
  FOREIGN KEY (organization_id, decided_by) REFERENCES app_user (organization_id, id);

SELECT apply_tenant_rls('attendance_correction');
GRANT SELECT, INSERT, UPDATE ON attendance_correction TO tapcrm_app;
REVOKE DELETE ON attendance_correction FROM tapcrm_app;

-- FK that attendance_event.correction_id has waited for since step 3 (§8.1, §12.1).
ALTER TABLE attendance_event
  ADD CONSTRAINT fk_attendance_event_correction
  FOREIGN KEY (organization_id, user_id, correction_id)
  REFERENCES attendance_correction (organization_id, user_id, id);

-- Review queue (§12.2).
--
-- resolution_source distinguishes human approvals (resolved_by IS NOT NULL) from
-- automatic system resolutions (resolved_by IS NULL, resolution_source = 'system').
-- The CHECK enforces that a resolved row must carry a source, and a human-resolved
-- row must carry a resolver.
CREATE TABLE attendance_review_item (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  user_id          uuid NOT NULL,
  work_date        date NOT NULL,
  kind             text NOT NULL CHECK (kind IN (
    'assumed-departure', 'auto-close-failed', 'reconciled-from-auto-close',
    'overtime-on-assumed', 'same-instant-conflict', 'departure-without-arrival',
    'previous-session-unconfirmed', 'worked-remotely-without-approval', 'punched-on-leave',
    'holiday-worked', 'activity-after-finish', 'late-synced-punch',
    'outside-shift-window', 'overlapping-shift-windows', 'not-evaluated',
    'retime-changes-subject'
  )),
  event_id         uuid,
  detail           jsonb NOT NULL DEFAULT '{}',
  opened_at        timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz,
  resolved_by      uuid,               -- NULL for system resolutions
  resolution_source text CHECK (resolution_source IN ('human', 'system')),
  resolution_note  text,
  correction_id    uuid,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, user_id, id),
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id),
  -- resolved_by and correction_id are same-org, nullable (D34).
  FOREIGN KEY (organization_id, resolved_by)   REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, user_id, correction_id)
    REFERENCES attendance_correction (organization_id, user_id, id),
  FOREIGN KEY (organization_id, user_id, event_id)
    REFERENCES attendance_event (organization_id, user_id, id),
  CHECK (resolved_at IS NULL OR resolution_source IS NOT NULL),
  CHECK (
    (resolved_at IS NULL AND resolution_source IS NULL AND resolved_by IS NULL AND correction_id IS NULL)
    OR (resolved_at IS NOT NULL AND resolution_source = 'system' AND resolved_by IS NULL)
    OR (resolved_at IS NOT NULL AND resolution_source = 'human' AND resolved_by IS NOT NULL)
  )
);

-- One row per (day, kind, event_id) total for event-keyed items — prevents reopening
-- a closed item for the same evidence (§12.2). Non-partial: covers both open and closed.
CREATE UNIQUE INDEX ux_attendance_review_with_event
  ON attendance_review_item (organization_id, user_id, work_date, kind, event_id)
  WHERE event_id IS NOT NULL;

-- One OPEN row per (day, kind) for day-level items (event_id IS NULL).
-- Closed day-level items allow a new open item after a new attempt (e.g. auto-close-failed
-- on a new input version after fresh evidence).
CREATE UNIQUE INDEX ux_attendance_review_open_no_event
  ON attendance_review_item (organization_id, user_id, work_date, kind)
  WHERE resolved_at IS NULL AND event_id IS NULL;

SELECT apply_tenant_rls('attendance_review_item');
GRANT SELECT, INSERT, UPDATE ON attendance_review_item TO tapcrm_app;
REVOKE DELETE ON attendance_review_item FROM tapcrm_app;
```

- [ ] **Step 2: Extend the People privilege integration test**

Add both tables to `EXPECTED` in
`packages/server/src/platform/modules/people-privileges.integration.test.ts`,
following the Step 3/6 convention. The exact privilege strings are
alphabetical, and the test must detect an accidental DELETE grant:

```typescript
  attendance_correction: 'INSERT,SELECT,UPDATE',
  attendance_review_item: 'INSERT,SELECT,UPDATE',
```

- [ ] **Step 3: Run the migration and privilege test against PostgreSQL**

```bash
cd /Users/archismandutta/Desktop/TapIt/tapcrm
npm run migrate
TAPCRM_INTEGRATION_DB=1 npx vitest run \
  packages/server/src/platform/modules/people-privileges.integration.test.ts
```

Expected: migration applies without errors and the app role has exactly
SELECT, INSERT and UPDATE on both new tables, with no DELETE.

- [ ] **Step 4: Commit**

```bash
git add migrations/0062_corrections.sql \
        packages/server/src/platform/modules/people-privileges.integration.test.ts
git commit -m "feat(attendance): migration 0062 — corrections and review items (§12)"
```

---

### Task 2: closeDecision — pure closure-decision function

**Files:**
- Create: `packages/server/src/modules/attendance/close.ts`
- Create: `packages/server/src/modules/attendance/close.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/server/src/modules/attendance/close.test.ts
import { describe, expect, it } from 'vitest';
import type { AttendanceEventInput } from '@tapcrm/contracts';
import type { EligibilityWindow } from '@tapcrm/contracts';
import { closeDecision } from './close.js';

const WIN: EligibilityWindow = { from: '2026-01-10T08:00:00.000Z', to: '2026-01-10T20:00:00.000Z' };
const CAP        = new Date('2026-01-10T20:00:00.000Z');
const SHIFT_END  = new Date('2026-01-10T18:00:00.000Z');
const BEFORE_CAP = new Date('2026-01-10T09:00:00.000Z');
const AFTER_CAP  = new Date('2026-01-10T21:00:00.000Z');

function ev(
  kind: AttendanceEventInput['kind'],
  at: string,
  source: AttendanceEventInput['source'] = 'device',
): AttendanceEventInput {
  const evidence: AttendanceEventInput['evidence'] =
    kind === 'auto-out' || kind === 'scan' ? 'assumed' : 'confirmed';
  return { id: `${kind}-${at}`, kind, at, source, evidence };
}

describe('closeDecision', () => {
  it('real departure: departure event exists → real-departure', () => {
    const events = [ev('in', '2026-01-10T09:00:00.000Z'), ev('out', '2026-01-10T17:00:00.000Z')];
    expect(closeDecision(events, WIN, SHIFT_END, CAP, AFTER_CAP).kind).toBe('real-departure');
  });

  it('still open: now < closingCap', () => {
    const events = [ev('in', '2026-01-10T09:00:00.000Z')];
    expect(closeDecision(events, WIN, SHIFT_END, CAP, BEFORE_CAP).kind).toBe('still-open');
  });

  it('no-show: no events and now >= closingCap', () => {
    expect(closeDecision([], WIN, SHIFT_END, CAP, AFTER_CAP).kind).toBe('no-show');
  });

  it('auto-out: last scan is the last event → basis last-scan', () => {
    // scan at 16:00, nothing later
    const events = [ev('in', '2026-01-10T09:00:00.000Z'), ev('scan', '2026-01-10T16:00:00.000Z')];
    const r = closeDecision(events, WIN, SHIFT_END, CAP, AFTER_CAP);
    expect(r.kind).toBe('auto-out');
    if (r.kind !== 'auto-out') return;
    expect(r.at.toISOString()).toBe('2026-01-10T16:00:00.000Z');
    expect(r.basis).toBe('last-scan');
  });

  it('auto-out: non-scan event is later than last scan → fall through to shift-end', () => {
    // scan at 12:00, break-start at 13:00; actual shift end = 18:00 > 13:00
    const events = [
      ev('in',          '2026-01-10T09:00:00.000Z'),
      ev('scan',        '2026-01-10T12:00:00.000Z'),
      ev('break-start', '2026-01-10T13:00:00.000Z'),
    ];
    const r = closeDecision(events, WIN, SHIFT_END, CAP, AFTER_CAP);
    expect(r.kind).toBe('auto-out');
    if (r.kind !== 'auto-out') return;
    expect(r.at.toISOString()).toBe('2026-01-10T18:00:00.000Z'); // shift end
    expect(r.basis).toBe('shift-end');
  });

  it('auto-out: no window (flexible) → last event wins as last-event', () => {
    const events = [
      ev('in',          '2026-01-10T09:00:00.000Z', 'web'),
      ev('break-start', '2026-01-10T17:30:00.000Z', 'web'),
    ];
    const r = closeDecision(events, null, null, new Date('2026-01-10T23:00:00.000Z'), new Date('2026-01-11T00:00:00.000Z'));
    expect(r.kind).toBe('auto-out');
    if (r.kind !== 'auto-out') return;
    expect(r.at.toISOString()).toBe('2026-01-10T17:30:00.000Z');
    expect(r.basis).toBe('last-event');
  });

  it('no-shift working day past cap with no events → no-show', () => {
    expect(closeDecision([], null, null, CAP, AFTER_CAP).kind).toBe('no-show');
  });

  it('no-shift working day past cap with arrival and no departure → last-event', () => {
    const events = [
      ev('in', '2026-01-10T09:00:00.000Z', 'web'),
      ev('break-start', '2026-01-10T17:30:00.000Z', 'web'),
    ];
    const r = closeDecision(events, null, null, CAP, AFTER_CAP);
    expect(r.kind).toBe('auto-out');
    if (r.kind !== 'auto-out') return;
    expect(r.basis).toBe('last-event');
    expect(r.at.toISOString()).toBe('2026-01-10T17:30:00.000Z');
  });

  it('no-shift working day with a real out → real-departure', () => {
    const events = [
      ev('in', '2026-01-10T09:00:00.000Z', 'web'),
      ev('out', '2026-01-10T17:00:00.000Z', 'web'),
    ];
    expect(closeDecision(events, null, null, CAP, AFTER_CAP).kind).toBe('real-departure');
  });

  it('auto-out: shift-end not later than last event → last-event', () => {
    // The confirmed correction at 19:00 is eligible beyond the 18:00 shift end.
    const events = [
      ev('in',         '2026-01-10T09:00:00.000Z'),
      ev('break-start','2026-01-10T19:00:00.000Z', 'correction'), // correction: always eligible
    ];
    const shortCap = new Date('2026-01-10T21:00:00.000Z');
    const r = closeDecision(events, WIN, SHIFT_END, shortCap, new Date('2026-01-10T22:00:00.000Z'));
    // The correction break-start at 19:00 is the last eligible event; shift-end (18:00) <= 19:00
    expect(r.kind).toBe('auto-out');
    if (r.kind !== 'auto-out') return;
    expect(r.at.toISOString()).toBe('2026-01-10T19:00:00.000Z');
    expect(r.basis).toBe('last-event');
  });

  it('D32 ordering: a same-second break-start follows the scan, so shift-end wins', () => {
    const t = '2026-01-10T16:00:00.000Z';
    const events = [
      ev('in',          '2026-01-10T09:00:00.000Z'),
      ev('scan',        t),
      ev('break-start', t), // same second as scan
    ];
    const r = closeDecision(events, WIN, SHIFT_END, CAP, AFTER_CAP);
    expect(r.kind).toBe('auto-out');
    if (r.kind !== 'auto-out') return;
    expect(r.basis).toBe('shift-end');
    expect(r.at.toISOString()).toBe('2026-01-10T18:00:00.000Z');
  });

  it('correction events always eligible regardless of window', () => {
    const events = [
      ev('in',  '2026-01-10T07:00:00.000Z', 'correction'), // before window.from
      ev('out', '2026-01-10T09:00:00.000Z', 'correction'),
    ];
    expect(closeDecision(events, WIN, SHIFT_END, CAP, AFTER_CAP).kind).toBe('real-departure');
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd /Users/archismandutta/Desktop/TapIt/tapcrm
npx vitest run packages/server/src/modules/attendance/close.test.ts
```

Expected: FAIL — `close.ts` does not exist.

- [ ] **Step 3: Implement closeDecision**

```typescript
// packages/server/src/modules/attendance/close.ts
import type { AttendanceEventInput } from '@tapcrm/contracts';
import { compareEvents, readDay } from '@tapcrm/contracts';
import type { EligibilityWindow } from '@tapcrm/contracts';

export type CloseDecision =
  | { readonly kind: 'real-departure' }
  | { readonly kind: 'still-open' }
  | { readonly kind: 'no-show' }
  | { readonly kind: 'auto-out'; readonly at: Date; readonly basis: 'last-scan' | 'shift-end' | 'last-event' };

/**
 * Pure closure decision — §12.3. Caller supplies the day's effective events
 * WITHOUT the day's own auto-out (attribution ignores auto-outs; excluding them
 * here prevents re-derivation from ever looping).
 *
 * `window` is the eligibility window, whose `to` is closingCap in current
 * DayFacts. `shiftEnd` is separate; never use `window.to` as shift end.
 */
export function closeDecision(
  events: readonly AttendanceEventInput[],
  window: EligibilityWindow | null,
  shiftEnd: Date | null,
  closingCap: Date,
  now: Date,
): CloseDecision {
  const reading = readDay(events, window);
  if (reading.departure !== null) return { kind: 'real-departure' };
  if (now < closingCap) return { kind: 'still-open' };
  if (reading.arrival === null) return { kind: 'no-show' };

  // arrival, but no departure — place the auto-out (§12.3).
  const eligibleEvents = events.filter((e) => {
    if (window === null || e.source === 'correction') return true;
    const t = Date.parse(e.at);
    return t >= Date.parse(window.from) && t <= Date.parse(window.to);
  });

  const arrivalMs = Date.parse(reading.arrival.at);

  // D32 governs both the final event and whether a scan is final evidence.
  const ordered = [...eligibleEvents].sort(compareEvents);
  const lastEvent = ordered.at(-1) ?? null;
  const lastEventMs = lastEvent ? Date.parse(lastEvent.at) : arrivalMs;

  // "Later second than arrival" is a time test. "No event later than scan"
  // uses D32: break-start in the same second follows scan.
  const lastScan = ordered.filter(
    (e) => e.kind === 'scan' && Date.parse(e.at) > arrivalMs,
  ).at(-1);
  if (lastScan !== undefined && !ordered.some((e) => compareEvents(e, lastScan) > 0)) {
    return { kind: 'auto-out', at: new Date(lastScan.at), basis: 'last-scan' };
  }

  const shiftEndMs = shiftEnd?.getTime() ?? -Infinity;
  if (shiftEndMs > lastEventMs) {
    return { kind: 'auto-out', at: new Date(shiftEndMs), basis: 'shift-end' };
  }

  // Last eligible event's time — never earlier than arrival (safety).
  return { kind: 'auto-out', at: new Date(Math.max(lastEventMs, arrivalMs)), basis: 'last-event' };
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run packages/server/src/modules/attendance/close.test.ts
```

Expected: all 12 tests pass, including the exact same-second D32 answer
and the three no-shift closure cases.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/modules/attendance/close.ts \
        packages/server/src/modules/attendance/close.test.ts
git commit -m "feat(attendance): closeDecision pure function with D32-correct ordering (§12.3)"
```

---

### Task 3: Repository additions

**Files:**
- Modify: `packages/server/src/modules/attendance/repository.ts`

- [ ] **Step 1: Append review item types and functions**

```typescript
/* ------------------------------------------------------------------ *
 * Review items (§12.2)
 * ------------------------------------------------------------------ */

export type ReviewItemKind =
  | 'assumed-departure' | 'auto-close-failed' | 'reconciled-from-auto-close'
  | 'overtime-on-assumed' | 'same-instant-conflict' | 'departure-without-arrival'
  | 'previous-session-unconfirmed' | 'worked-remotely-without-approval' | 'punched-on-leave'
  | 'holiday-worked' | 'activity-after-finish' | 'late-synced-punch'
  | 'outside-shift-window' | 'overlapping-shift-windows' | 'not-evaluated'
  | 'retime-changes-subject';

/** Opens an item. For event_id IS NOT NULL: idempotent (unique index prevents duplicate).
 *  For event_id IS NULL: opens a new item only when none is currently open. */
export async function upsertReviewItem(
  tx: Tx,
  organizationId: string,
  item: {
    userId: string;
    workDate: DateOnly;
    kind: ReviewItemKind;
    eventId?: string | null;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  await tx.query(sql`
    INSERT INTO attendance_review_item (organization_id, user_id, work_date, kind, event_id, detail)
    VALUES (${organizationId}, ${item.userId}, ${item.workDate}, ${item.kind},
            ${item.eventId ?? null}, ${JSON.stringify(item.detail ?? {})}::jsonb)
    ON CONFLICT DO NOTHING
  `);
}

/** Resolves an open item. Pass `resolvedBy` for human closures; omit for system closures. */
export async function resolveReviewItem(
  tx: Tx,
  organizationId: string,
  item: {
    userId: string;
    workDate: DateOnly;
    kind: ReviewItemKind;
    eventId?: string | null;
    resolvedBy?: string | null;
    correctionId?: string | null;
    note?: string | null;
  },
): Promise<void> {
  const source = item.resolvedBy != null ? 'human' : 'system';
  await tx.query(sql`
    UPDATE attendance_review_item
    SET resolved_at      = now(),
        resolved_by      = ${item.resolvedBy ?? null},
        resolution_source = ${source},
        resolution_note  = ${item.note ?? null},
        correction_id    = ${item.correctionId ?? null}
    WHERE organization_id = ${organizationId}
      AND user_id   = ${item.userId}
      AND work_date = ${item.workDate}
      AND kind      = ${item.kind}
      AND (event_id = ${item.eventId ?? null}
           OR (event_id IS NULL AND ${item.eventId ?? null} IS NULL))
      AND resolved_at IS NULL
  `);
}

/** The current (non-void, non-superseded) auto-out assigned to this record, if any. */
export async function findAutoOutForRecord(
  tx: Tx,
  recordId: string,
): Promise<{ id: string; occurredAt: Date } | null> {
  return tx.maybeOne<{ id: string; occurredAt: Date }>(sql`
    SELECT e.id, e.occurred_at AS "occurredAt"
    FROM   attendance_event e
    JOIN   attendance_event_assignment a
           ON  a.organization_id      = e.organization_id
           AND a.event_id             = e.id
    WHERE  a.attendance_record_id = ${recordId}
      AND  e.kind     = 'auto-out'
      AND  e.is_void  = false
      AND  NOT EXISTS (
             SELECT 1 FROM attendance_event v
             WHERE  v.organization_id      = e.organization_id
               AND  v.supersedes_event_id  = e.id
           )
    LIMIT 1
  `);
}

/** Effective events for one record, optionally excluding auto-outs. */
export async function effectiveEventsOfRecord(
  tx: Tx,
  recordId: string,
  options: { excludeAutoOut?: boolean } = {},
): Promise<NeighbourhoodEvent[]> {
  return tx.query<NeighbourhoodEvent>(sql`
    SELECT e.id, e.user_id AS "userId", e.kind, e.occurred_at AS "occurredAt",
           e.source, e.evidence, e.is_void AS "isVoid",
           a.attendance_record_id AS "recordId",
           a.attendance_record_id AS "assignedRecordId",
           r.work_date::text       AS "assignedDate",
           a.reason, a.pinned
    FROM   attendance_event e
    JOIN   attendance_event_assignment a
           ON  a.organization_id = e.organization_id AND a.event_id = e.id
    JOIN   attendance_record r
           ON  r.id = a.attendance_record_id
    WHERE  a.attendance_record_id = ${recordId}
      AND  e.is_void = false
      AND  NOT EXISTS (
             SELECT 1 FROM attendance_event v
             WHERE  v.organization_id = e.organization_id
               AND  v.supersedes_event_id = e.id
           )
      AND  (${options.excludeAutoOut !== true}::boolean OR e.kind <> 'auto-out')
    ORDER BY e.occurred_at, e.kind
  `);
}

/** Lock the derived day after the caller holds the person's advisory lock. */
export async function findRecordForClosure(
  tx: Tx,
  userId: string,
  workDate: DateOnly,
): Promise<{ id: string; state: 'open' | 'closed'; dayType: string;
  closeDueAt: Date; closedBy: string | null; inputVersion: number } | null> {
  return tx.maybeOne<{ id: string; state: 'open' | 'closed'; dayType: string;
    closeDueAt: Date; closedBy: string | null; inputVersion: number }>(sql`
    SELECT id, state, day_type AS "dayType", close_due_at AS "closeDueAt",
           closed_by AS "closedBy", input_version AS "inputVersion"
    FROM attendance_record
    WHERE user_id = ${userId} AND work_date = ${workDate}
    FOR UPDATE
  `);
}

/** A derived answer can change on a closed record. Write only real changes. */
export async function setRecordClosure(
  tx: Tx,
  recordId: string,
  answer: { state: 'open'; closedBy: null } |
    { state: 'closed'; closedBy: 'punch-out' | 'auto-close' | 'no-show' | 'correction' },
  now: Date,
): Promise<boolean> {
  const rows = await tx.query<{ id: string }>(sql`
    UPDATE attendance_record
    SET state = ${answer.state},
        closed_by = ${answer.closedBy},
        closed_at = CASE WHEN ${answer.state} = 'open' THEN NULL ELSE ${now}::timestamptz END
    WHERE id = ${recordId}
      AND (state, closed_by) IS DISTINCT FROM (${answer.state}::text, ${answer.closedBy}::text)
    RETURNING id
  `);
  return rows.length === 1;
}
```

- [ ] **Step 2: Append correction functions**

```typescript
/* ------------------------------------------------------------------ *
 * Corrections (§12.1)
 * ------------------------------------------------------------------ */

export interface CorrectionRow {
  readonly id: string;
  readonly userId: string;
  readonly workDate: DateOnly;
  readonly kind: 'add-event' | 'replace-event' | 'void-event' | 'confirm-as-is';
  readonly payload: unknown;
  readonly reason: string;
  readonly batchId: string | null;
  readonly status: 'pending' | 'approved' | 'rejected';
  readonly requestedBy: string;
  readonly decidedBy: string | null;
  readonly decidedAt: Date | null;
  readonly decisionNote: string | null;
}

export async function insertCorrection(
  tx: Tx,
  c: {
    organizationId: string;
    userId: string;
    workDate: DateOnly;
    kind: CorrectionRow['kind'];
    payload: unknown;
    reason: string;
    batchId?: string | null;
    requestedBy: string;
  },
): Promise<string> {
  const row = await tx.one<{ id: string }>(sql`
    INSERT INTO attendance_correction
      (organization_id, user_id, work_date, kind, payload, reason, batch_id, requested_by)
    VALUES
      (${c.organizationId}, ${c.userId}, ${c.workDate}, ${c.kind},
       ${JSON.stringify(c.payload)}::jsonb, ${c.reason}, ${c.batchId ?? null}, ${c.requestedBy})
    RETURNING id
  `);
  return row.id;
}

export async function findCorrectionById(
  tx: Tx,
  id: string,
): Promise<CorrectionRow | null> {
  return tx.maybeOne<CorrectionRow>(sql`
    SELECT id, user_id AS "userId", work_date::text AS "workDate", kind, payload, reason,
           batch_id AS "batchId", status, requested_by AS "requestedBy",
           decided_by AS "decidedBy", decided_at AS "decidedAt",
           decision_note AS "decisionNote"
    FROM attendance_correction
    WHERE id = ${id}
  `);
}

export async function findCorrectionForUpdate(
  tx: Tx,
  id: string,
): Promise<CorrectionRow | null> {
  return tx.maybeOne<CorrectionRow>(sql`
    SELECT id, user_id AS "userId", work_date::text AS "workDate", kind, payload, reason,
           batch_id AS "batchId", status, requested_by AS "requestedBy",
           decided_by AS "decidedBy", decided_at AS "decidedAt",
           decision_note AS "decisionNote"
    FROM attendance_correction
    WHERE id = ${id}
    FOR UPDATE
  `);
}

export async function updateCorrectionStatus(
  tx: Tx,
  id: string,
  update: { status: 'approved' | 'rejected'; decidedBy: string; decidedAt: Date; decisionNote?: string | null },
): Promise<void> {
  await tx.query(sql`
    UPDATE attendance_correction
    SET status       = ${update.status},
        decided_by   = ${update.decidedBy},
        decided_at   = ${update.decidedAt},
        decision_note = ${update.decisionNote ?? null}
    WHERE id = ${id}
  `);
}

/** Returns the effective event AND its assigned workDate; null if not effective. */
export async function findEffectiveEvent(
  tx: Tx,
  userId: string,
  eventId: string,
): Promise<{ id: string; kind: EventKind; occurredAt: Date; source: EventSource;
  evidence: Evidence; recordId: string | null; workDate: DateOnly | null } | null> {
  return tx.maybeOne<{ id: string; kind: EventKind; occurredAt: Date; source: EventSource;
    evidence: Evidence; recordId: string | null; workDate: DateOnly | null }>(sql`
    SELECT e.id, e.kind, e.occurred_at AS "occurredAt", e.source, e.evidence,
           a.attendance_record_id AS "recordId",
           r.work_date::text       AS "workDate"
    FROM   attendance_event e
    LEFT JOIN attendance_event_assignment a
              ON  a.organization_id = e.organization_id AND a.event_id = e.id
    LEFT JOIN attendance_record r
              ON  r.id = a.attendance_record_id
    WHERE  e.id = ${eventId} AND e.user_id = ${userId}
      AND  e.is_void = false
      AND  NOT EXISTS (
             SELECT 1 FROM attendance_event v
             WHERE  v.organization_id = e.organization_id
               AND  v.supersedes_event_id = e.id
           )
  `);
}

/** Loads a user's dept/team for authorization scope checks (mirrors shifts pattern). */
export async function findCorrectionSubject(
  tx: Tx,
  userId: string,
): Promise<{ id: string; organizationId: string; departmentId: string | null; teamId: string | null } | null> {
  return tx.maybeOne<{ id: string; organizationId: string;
    departmentId: string | null; teamId: string | null }>(sql`
    SELECT id, organization_id AS "organizationId",
           department_id AS "departmentId", team_id AS "teamId"
    FROM app_user
    WHERE id = ${userId} AND account_type = 'employee'
  `);
}
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc -p packages/server/tsconfig.json --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/modules/attendance/repository.ts
git commit -m "feat(attendance): review item + correction repository functions (§12)"
```

---

### Task 4: applyCloseDecision + step 10 wiring

**Files:**
- Modify: `packages/server/src/modules/attendance/ledger.ts`

- [ ] **Step 1: Keep shift end separate from closingCap**

In `day-facts.ts`, add `shiftEnd: Date | null` to `DayFacts`. In
`dayFacts`, set it to `window.shape.end` for fixed shifts and `null`
for flexible/no-shift days. Their current `eligibility: null` denotes
the whole attributed day for `readDay`; it does not disable closure.
Do not derive shift end from `eligibility.to`:
the existing `eligibility.to` is `closingCap`, which can be hours later.
Add a focused `day-facts` test with shift end 18:00 and cap 20:00.

- [ ] **Step 2: Replace open-only closure updates with re-derivation**

Add static imports `readDay` from `@tapcrm/contracts` and
`closeDecision` from `./close.js` to `ledger.ts`. Use
`findRecordForClosure` after taking the person's lock; it obtains the
record row lock and supplies `state` and `closeDueAt`. Skip
`dayType === 'not-employed'`, missing facts, and an
overlapping shift. Evaluate a working day with `shift.kind === 'none'`
using `facts.eligibility` and `shiftEnd = null`, so it can become
no-show, close from a real departure, or receive a last-evidence
auto-out. Do not use calculated `status = 'not-evaluated'` as a blanket
skip: the design assigns that status to no-shift working days for
payroll, while closure still has an answer. The database `state` is
only `open | closed`.

```typescript
export async function applyCloseDecision(
  tx: Tx, userId: string, workDate: DateOnly, clock: Clock = systemClock,
): Promise<void> {
  const organizationId = await organizationIdOf(tx);
  const record = await repo.findRecordForClosure(tx, userId, workDate);
  if (record === null || record.dayType === 'not-employed') return;
  const facts = (await loadFacts(tx, userId, workDate, workDate)).get(workDate);
  if (facts === undefined || facts.overlap) return;

  const raw = await repo.effectiveEventsOfRecord(tx, record.id, { excludeAutoOut: true });
  const events = raw.map(toInput);
  const decision = closeDecision(
    events, facts.eligibility, facts.shiftEnd, record.closeDueAt, clock.now(),
  );
  const old = await repo.findAutoOutForRecord(tx, record.id);
  let ledgerChanged = false;

  const retireOld = async (note: string): Promise<void> => {
    if (old === null) return;
    await voidAutoOut(tx, organizationId, userId, old.id, record.id);
    ledgerChanged = true;
    await repo.resolveReviewItem(tx, organizationId, {
      userId, workDate, kind: 'assumed-departure', eventId: old.id, note,
    });
  };

  let answer:
    | { state: 'open'; closedBy: null }
    | { state: 'closed'; closedBy: 'punch-out' | 'auto-close' | 'no-show' | 'correction' };

  if (decision.kind === 'still-open') {
    await retireOld('Re-derived as still open.');
    answer = { state: 'open', closedBy: null };
  } else if (decision.kind === 'real-departure') {
    await retireOld('Replaced by a real departure.');
    const departure = readDay(events, facts.eligibility).departure;
    const corrected = raw.some((e) =>
      e.source === 'correction' && departure?.eventIds.includes(e.id));
    answer = { state: 'closed', closedBy: corrected ? 'correction' : 'punch-out' };
  } else if (decision.kind === 'no-show') {
    await retireOld('Re-derived as no-show.');
    answer = { state: 'closed', closedBy: 'no-show' };
  } else {
    if (old === null || old.occurredAt.getTime() !== decision.at.getTime()) {
      await retireOld(`Re-derived auto-out at ${decision.at.toISOString()}.`);
      const autoOutId = await repo.insertEvent(tx, {
        organizationId, userId, kind: 'auto-out', occurredAt: decision.at,
        source: 'system', evidence: 'assumed',
      });
      await repo.assign(tx, {
        organizationId, userId, eventId: autoOutId, recordId: record.id,
        reason: 'system-close', pinned: true,
      });
      ledgerChanged = true;
      if (decision.basis !== 'last-scan') {
        await repo.upsertReviewItem(tx, organizationId, {
          userId, workDate, kind: 'assumed-departure', eventId: autoOutId,
          detail: { basis: decision.basis, autoOutAt: decision.at.toISOString() },
        });
      }
    }
    answer = { state: 'closed', closedBy: 'auto-close' };
  }

  const closureChanged = await repo.setRecordClosure(tx, record.id, answer, clock.now());
  // Any successful derivation supersedes a prior evaluation failure, even if
  // refreshed facts put closingCap in the future and the day is still open.
  await repo.resolveReviewItem(tx, organizationId, {
    userId, workDate, kind: 'auto-close-failed',
    note: 'Closure was successfully re-derived.',
  });
  // One version/outbox bump for this pass, including a retirement-only path.
  if (ledgerChanged || closureChanged)
    await repo.bumpInputVersions(tx, organizationId, userId, new Set([record.id]));
}
```

`voidAutoOut` appends one `source='system'`, `is_void=true` row
superseding the old auto-out and assigns that void row to the same record,
`reason='reconciliation'`, `pinned=true`. It does **not** bump the
version itself; the caller above does that once for the whole decision.
The unique supersession index is the concurrency backstop.

- [ ] **Step 3: Return every changed date from attribution**

Extend `PassResult` and `reattribute` with `touchedDates:
ReadonlySet<DateOnly>`. Add `additionalTouchedRecordIds?: ReadonlySet<string>`
to `ReattributeOptions`; seed the internal `touched` set from it. This
allows correction approval to mark the old target record and the new
pinned event's record, even when neither assignment changes in the pass.
Convert the final `touched` record IDs to dates from the locked `records`
map before returning; include an ID's date via an explicit lookup if it
falls outside that map. Keep one `bumpInputVersions` call for the union.
The returned dates include outer days reached by a widened pass.

- [ ] **Step 4: Wire every writer and fact refresh**

Thread `clock` through `insertLocked` from `appendEvent` and
`replaceDeviceEvent`. After `reattribute`, call
`applyCloseDecision` for the sorted union of `touchedDates`,
the new event's assigned date (if any), and `alsoAround`.
`retireEvent` must do the same after its own `reattribute`.
In `recalculate.ts`, `requestRecalculation` must use the returned
`touchedDates` to re-derive changed facts/closingCap before its
transaction commits. Preserve the person's lock and ascending record-lock
order. Do not run step 10 only for the new event's local calendar date.
Add `repo.hasRetiredAutoOut(tx, recordId)` and make
`recalculateRecord` include `reconciled-from-auto-close` in the
calculator's flags when that append-only evidence exists. This flag is
derived from the ledger and survives later recalculations; the
frozen/published **review item** remains the payroll follow-up.

- [ ] **Step 5: Verify the closure matrix before proceeding**

Add real-PostgreSQL assertions for open → auto-close, auto-close →
punch-out, auto-close → changed auto-out, no-show → auto-close after a
late arrival, and auto-close → still-open after evidence is voided.
Assert `state`, `closed_by`, one current auto-out, one void per
retired auto-out, review-item resolution, and a matching
`attendance.recalc-requested` outbox row for every new input version.
Also test a widened neighbourhood where an outer day changes, all
three closure outcomes for a working no-shift day, and resolution of
an old `auto-close-failed` item after a successful `still-open`
re-derivation.
These cases are part of Task 9's mandatory gate.

- [ ] **Step 6: Typecheck**

```bash
npx tsc -p packages/server/tsconfig.json --noEmit
```

Expected: 0 errors.

- [ ] **Step 7: Run existing ledger tests**

```bash
TAPCRM_INTEGRATION_DB=1 npx vitest run packages/server/src/modules/attendance/ledger.integration.test.ts
```

Expected: all existing tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/modules/attendance/ledger.ts \
        packages/server/src/modules/attendance/repository.ts \
        packages/server/src/modules/attendance/day-facts.ts \
        packages/server/src/modules/attendance/day-facts.test.ts \
        packages/server/src/modules/attendance/recalculate.ts
git commit -m "feat(attendance): applyCloseDecision + step 10 wiring; bumpInputVersions on all retirement paths (§12.3, §12.4)"
```

---

### Task 5: Auto-close job and bounded generations

**Files:**
- Modify: `packages/server/src/modules/attendance/jobs.ts`
- Test: `packages/server/src/modules/attendance/correction.integration.test.ts`

Step 0 already implements `JobHandle.nextGeneration(tx, baseKey, now)`.
Use it. Three **attempts per generation** and at most three generations
are separate limits. A failed attempt's transaction rolls back; the
`auto-close-failed` review item is written by a later successful scan
transaction after generation three is exhausted. This preserves the
item without racing the runner's dead-letter write.

- [ ] **Step 1: Define the item job**

Add `sql`, `DateOnly` and `applyCloseDecision` imports to
`jobs.ts`. Register `attendance.auto-close-item` with
`perOrganization: true`, `module: 'attendance'` and `attempts: 3`.
Its payload includes `recordId`, `userId`, `workDate` and
`inputVersion`. In a transaction, take `repo.lockPerson`, then use
`findRecordForClosure`. Return successfully without writing if the row
is missing, already closed, no longer due, has another ID, or has a
different input version. Otherwise call `applyCloseDecision` with the
job clock. Let errors propagate to the runner; it records retries and
dead letters. Do not write a review item in the failed transaction.

- [ ] **Step 2: Define the hourly scan**

Register `attendance.auto-close` at `:30` hourly. Select by
`state='open' AND close_due_at <= now`, without a date lookback.
Use keyset pagination by `(close_due_at, id)` in pages of 500 so
exhausted old rows cannot starve later rows. For each page, in a
successful DB transaction, calculate:

```typescript
const baseKey = `auto-close:${record.id}:${record.inputVersion}`;
const next = await autoCloseItemJob.nextGeneration(tx, baseKey, now);
if (next.kind === 'exhausted') {
  await repo.upsertReviewItem(tx, ctx.organizationId, {
    userId: record.userId,
    workDate: record.workDate,
    kind: 'auto-close-failed',
    detail: { recordId: record.id, inputVersion: record.inputVersion, generations: 3 },
  });
} else if (next.kind === 'run') {
  offers.push({ key: next.key, record });
}
```

Do not enqueue while the database transaction is open (TX-2). After
commit, offer each `next.key` through `autoCloseItemJob.enqueue`
with the matching payload. `wait` and `done` produce no enqueue.
For an unchanged input version, generations two and three become
eligible only after Step 0's 24-hour dead-letter delay. New evidence
bumps `input_version`, making a new base key and retry budget; resolve
an old open `auto-close-failed` item when that new answer succeeds,
including when the refreshed cap makes the answer `still-open`.

Add `autoClose` to `AttendanceJobs` and the return object. Keep the
scan's own attempt count at one.

- [ ] **Step 3: Test the actual runner path**

In the mandatory PostgreSQL gate, prove that failed closure writes roll
back, the scan offers generation two only after one day, generation
three only after another day, and `auto-close-failed` appears after
the third dead letter in a **different successful transaction**.
Assert it survives the failed item transaction. Do not substitute a
test of `3 >= 3` or manually insert the review item; those do not
exercise the job.

- [ ] **Step 4: Typecheck and commit**

```bash
npx tsc -p packages/server/tsconfig.json --noEmit
git add packages/server/src/modules/attendance/jobs.ts
git commit -m "feat(attendance): hourly auto-close with bounded generations"
```

---

### Task 6: Errors, validators, policy + AT-10 constraint

**Files:**
- Modify: `packages/server/src/modules/attendance/errors.ts`
- Modify: `packages/server/src/modules/attendance/validators.ts`
- Modify: `packages/server/src/modules/attendance/policy.ts`

- [ ] **Step 1: Extend errors.ts**

Replace the existing `ATTENDANCE_ERROR_CODES` export and add the new classes:

```typescript
export const ATTENDANCE_ERROR_CODES = {
  CLIENT_EVENT_REUSED:       'ATTENDANCE_CLIENT_EVENT_REUSED',
  NO_DAY_FOR_INSTANT:        'ATTENDANCE_NO_DAY_FOR_INSTANT',
  EVENT_NOT_FOUND:           'ATTENDANCE_EVENT_NOT_FOUND',
  DAY_NOT_FOUND:             'ATTENDANCE_DAY_NOT_FOUND',
  RANGE_TOO_LONG:            'ATTENDANCE_RANGE_TOO_LONG',
  EXPORT_RANGE_TOO_LONG:     'ATTENDANCE_EXPORT_RANGE_TOO_LONG',
  EXPORT_EMPTY_SCOPE:        'ATTENDANCE_EXPORT_EMPTY_SCOPE',
  EXPORT_NOT_FOUND:          'ATTENDANCE_EXPORT_NOT_FOUND',
  // corrections
  CORRECTION_NOT_FOUND:         'ATTENDANCE_CORRECTION_NOT_FOUND',
  CORRECTION_TARGET_SUPERSEDED: 'ATTENDANCE_CORRECTION_TARGET_SUPERSEDED',
  CORRECTION_NOT_READABLE:      'ATTENDANCE_CORRECTION_NOT_READABLE',
  INVALID_CORRECTION_STATUS:    'ATTENDANCE_INVALID_CORRECTION_STATUS',
  CORRECTION_TOO_OLD:           'ATTENDANCE_CORRECTION_TOO_OLD',
  CORRECTION_OUT_OF_SCOPE:      'ATTENDANCE_CORRECTION_OUT_OF_SCOPE',
} as const;

export class AttendanceForbiddenError extends ApplicationError {
  constructor(code: string, message: string) {
    super(message, 403, code);
    this.name = 'AttendanceForbiddenError';
  }
}

export class AttendanceUnprocessableError extends ApplicationError {
  constructor(code: string, message: string) {
    super(message, 422, code);
    this.name = 'AttendanceUnprocessableError';
  }
}
```

- [ ] **Step 2: Rewrite validators.ts correction schemas as discriminated unions**

Append to `packages/server/src/modules/attendance/validators.ts`:

```typescript
// Payload schemas — each kind has exactly one shape. T-6 is checked before the
// database's whole-second CHECK, so callers get a validation error.
const eventAtSchema = z.string().datetime().refine(
  (value) => new Date(value).getUTCMilliseconds() === 0,
  'Event instant must be a whole second.',
);
const addEventPayload = z.object({
  kind: z.enum(['in', 'out', 'break-start', 'break-end']),
  at:   eventAtSchema,
});

const replaceEventPayload = z.object({
  targetEventId: z.string().uuid(),
  kind: z.enum(['in', 'out', 'break-start', 'break-end']),
  at:   eventAtSchema,
});

const voidEventPayload = z.object({
  targetEventId: z.string().uuid(),
});

const confirmAsIsPayload = z.object({
  reviewItemId: z.string().uuid(), // which open item this closes
});

// Discriminated unions: the parser validates kind + payload together.
const correctionBodyBase = z.object({
  workDate: dateSchema,
  reason:   z.string().min(20),
});

export const raiseCorrectionSchema = z.discriminatedUnion('kind', [
  correctionBodyBase.extend({ kind: z.literal('add-event'),    userId: z.string().uuid(), payload: addEventPayload }),
  correctionBodyBase.extend({ kind: z.literal('replace-event'), userId: z.string().uuid(), payload: replaceEventPayload }),
  correctionBodyBase.extend({ kind: z.literal('void-event'),   userId: z.string().uuid(), payload: voidEventPayload }),
  correctionBodyBase.extend({ kind: z.literal('confirm-as-is'), userId: z.string().uuid(), payload: confirmAsIsPayload }),
]);

export const requestCorrectionSchema = z.discriminatedUnion('kind', [
  correctionBodyBase.extend({ kind: z.literal('add-event'),    payload: addEventPayload }),
  correctionBodyBase.extend({ kind: z.literal('replace-event'), payload: replaceEventPayload }),
  correctionBodyBase.extend({ kind: z.literal('void-event'),   payload: voidEventPayload }),
  correctionBodyBase.extend({ kind: z.literal('confirm-as-is'), payload: confirmAsIsPayload }),
]);

export const approveSchema = z.object({
  decisionNote: z.string().min(1).optional(),
});

// Grouped creation only. A single targetEventId/reviewItemId cannot belong to
// many employees, so bulk accepts add-event alone until atomic AT-11 approval.
export const bulkCorrectionSchema = correctionBodyBase.extend({
  kind: z.literal('add-event'),
  userIds: z.array(z.string().uuid()).min(1).max(500)
    .refine((ids) => new Set(ids).size === ids.length, 'Duplicate user IDs.'),
  payload: addEventPayload,
});

export type RaiseCorrectionBody    = z.infer<typeof raiseCorrectionSchema>;
export type RequestCorrectionBody  = z.infer<typeof requestCorrectionSchema>;
export type ApproveBody            = z.infer<typeof approveSchema>;
export type BulkCorrectionBody     = z.infer<typeof bulkCorrectionSchema>;
```

- [ ] **Step 3: Add attendanceCorrectionPolicy and AT-10 privileged constraint to policy.ts**

The AT-10 constraint uses `kind: 'privileged'`, which runs at pipeline step 5 — AFTER the Super Admin bypass (step 4). Super Admin never reaches step 5 and is therefore exempt automatically, without any explicit Super Admin check in the constraint body.

```typescript
// New imports needed in policy.ts:
import {
  MATCH_NOTHING,
  registerConstraint,
  registerResourcePolicy,
  PASS,
  DENY,
  type ResourcePolicy,
} from '@tapcrm/authz';
import type { DateOnly, Scope } from '@tapcrm/contracts';
import { daysBetween } from '../../platform/time.js';

export const CORRECTION_LOOKBACK_DAYS = 60;

export const attendanceCorrectionPolicy: ResourcePolicy = {
  resourceType: 'attendanceCorrection',
  domain: 'people',
  async check(ctx, _action, resource, scope: Scope) {
    if (resource['organizationId'] !== ctx.organizationId) return false;
    if (scope === 'all-people') return true;
    if (scope === 'own') return resource['userId'] === ctx.principal.id;
    if (scope === 'department') {
      const departmentId = resource['departmentId'];
      return typeof departmentId === 'string' &&
        departmentId === (await ctx.scope.departmentId(ctx));
    }
    const userId = resource['userId'];
    if (typeof userId !== 'string') return false;
    if (scope === 'pool') return (await ctx.scope.poolMemberIds(ctx)).has(userId);
    const teamId = resource['teamId'];
    if (scope === 'team' && typeof teamId === 'string')
      return (await ctx.scope.teamIds(ctx)).has(teamId);
    return false;
  },
  async filter(ctx, _action, scope) {
    if (scope === 'all-people') return { sql: 'TRUE', parameters: [] };
    if (scope === 'own') return { sql: 'u.id = $1', parameters: [ctx.principal.id] };
    if (scope === 'department') {
      const departmentId = await ctx.scope.departmentId(ctx);
      return departmentId === null
        ? MATCH_NOTHING
        : { sql: 'u.department_id = $1', parameters: [departmentId] };
    }
    if (scope === 'team') {
      const teams = [...(await ctx.scope.teamIds(ctx))];
      return teams.length === 0
        ? MATCH_NOTHING
        : { sql: 'u.team_id = ANY($1::uuid[])', parameters: [teams] };
    }
    if (scope === 'pool') {
      const members = [...(await ctx.scope.poolMemberIds(ctx))];
      return members.length === 0
        ? MATCH_NOTHING
        : { sql: 'u.id = ANY($1::uuid[])', parameters: [members] };
    }
    return MATCH_NOTHING;
  },
  participantFields() { return []; },
  initiatorField() { return 'requestedBy'; },
};

export function registerAttendancePolicies(): void {
  registerResourcePolicy(attendanceRecordPolicy);
  registerResourcePolicy(attendanceCorrectionPolicy);

  // AT-10 — Privileged (step 5): runs AFTER the Super Admin bypass (step 4), so
  // Super Admin is exempt automatically. Every other principal is denied on days
  // older than CORRECTION_LOOKBACK_DAYS. The resource loader/service supplies
  // organizationToday from the tenant's zone and an injectable Clock.
  registerConstraint({
    id: 'P9',
    kind: 'privileged',
    appliesTo: ['attendance:correct', 'attendance:raise-correction', 'attendance:request-correction'],
    describe: `AT-10: corrections on days older than ${CORRECTION_LOOKBACK_DAYS} days are Super Admin only.`,
    evaluate: (_ctx, _action, resource) => {
      if (resource === undefined || resource.type !== 'attendanceCorrection') return PASS;
      const workDate = resource['workDate'] as string | undefined;
      const today = resource['organizationToday'] as string | undefined;
      if (!workDate || !today)
        return DENY('P9: correction resource lacks workDate or organizationToday.');
      const ageDays = daysBetween(workDate as DateOnly, today as DateOnly);
      if (ageDays <= CORRECTION_LOOKBACK_DAYS) return PASS;
      return DENY(
        `AT-10: ${workDate} is ${ageDays} days ago. Correcting days older than ` +
        `${CORRECTION_LOOKBACK_DAYS} days is a Super Admin privilege.`,
      );
    },
  });
}
```

- [ ] **Step 4: Typecheck**

```bash
npx tsc -p packages/server/tsconfig.json --noEmit
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/modules/attendance/errors.ts \
        packages/server/src/modules/attendance/validators.ts \
        packages/server/src/modules/attendance/policy.ts
git commit -m "feat(attendance): errors, discriminated-union validators, attendanceCorrectionPolicy, AT-10 privileged constraint (P9)"
```

---

### Task 7: Correction service

**Files:**
- Create: `packages/server/src/modules/attendance/correction.ts`
- Modify: `packages/server/src/modules/attendance/ledger.ts` (eligibility helper)

- [ ] **Step 1: Write behavior tests before the service**

Test AT-10 at 60 and 61 organization-local days with a fixed clock,
ordinary corrector denial, and Super Admin bypass. Test direct service
calls as well as the approval HTTP route. Test A1 (requester cannot
decide) and G4 (subject cannot decide) before any correction event is
inserted. A constant-only test does not exercise those rules.

- [ ] **Step 2: Authorize every creation path with a dated resource**

`authorizeSubject(ctx, tx, userId, workDate, action, clock)` loads
`findCorrectionSubject` and calls `authorize` with a resource containing
`type: 'attendanceCorrection'`, subject ID, organization, department,
team, `workDate`, and `organizationToday: await
organizationToday(tx, clock)`. Raise uses `attendance:raise-correction`; an
employee request uses `attendance:request-correction` and
`ctx.principal.id`. Bulk validates **all** subject resources before
inserting any row, then creates pending `add-event` corrections with
one `batchId`. It has no batch-approval semantics. Do not silently
accept `replace-event`, `void-event` or `confirm-as-is` with one
shared target/review-item ID in the bulk schema.

- [ ] **Step 3: Approve under the person's lock and re-authorize**

Read the correction once to learn its user ID. Take
`repo.lockPerson(tx, userId)`, then `findCorrectionForUpdate`.
Require `pending`, parse the stored `{kind,payload}` again, and
authorize `attendance:correct` with the **locked** resource containing
`requestedBy`, `workDate`, organization, current subject placement,
and `organizationToday(tx, clock)`. That invokes A1 and P9 for direct
service callers as well as HTTP callers. Explicitly reject
`decider === requestedBy` and `decider === userId` with a 403
application error before inserting or resolving anything; the
database CHECK remains the backstop. A Super Admin bypasses P9, not A1
or G4.

For `void-event` and `replace-event`, require the target to be
effective, assigned to this user **and** this `workDate`; otherwise
return 422 `CORRECTION_TARGET_SUPERSEDED`. Record its original
`recordId` in `additionalTouchedRecordIds`.

- [ ] **Step 4: Check readability using the actual day**

Expose `eligibilityForDay(tx, userId, workDate)` from `ledger.ts` as
a small wrapper over its existing `loadFacts`. For add/replace,
construct a provisional list from the day's effective events
**excluding auto-outs**. Remove the target for replacement, add a
proposed correction event, and call
`readDay(provisional, eligibilityForDay(...))`. The proposed event is
eligible outside the window because its source is `correction`; the
existing device/web events retain their normal window. Refuse when
`notApplied.has('proposed')`, including when the day has no record.
Do not pass `null` merely to make every existing event eligible.

- [ ] **Step 5: Append, pin, attribute, re-derive, and decide**

For add/replace/void, use
`ensureDayRecord(tx, userId, workDate, {emitRecalc:false})` to
materialize the named day; reject an ineligible subject/day if its
`recordId` is null. Add/replace events use
`source='correction'`, `evidence='confirmed'`,
`correctionId`, `recordedBy: ctx.principal.id`, and whole-second instants. A void row copies its
target's kind, instant **and evidence**, has `isVoid=true`, and
supersedes the target. Pin each new row to the named record via
`repo.assign(... reason:'correction', pinned:true)`, so a correction
near a shift boundary cannot drift to another work date.

Seed `additionalTouchedRecordIds` with the named record and, for
replace/void, the old target record. Run `reattribute` around the
named date, the new event's organization-local date (when different),
and the target's previous date. Its one version bump covers the
union. Call `applyCloseDecision` on every returned `touchedDate`
and on the named date. Refresh the live projector for the person at
`clock.now()` through the ledger's existing refresh helper (or expose
a narrow wrapper); only then set correction status to approved with
`decidedAt: clock.now()`. Write a `correction.decided` domain-outbox
event and an `audit_outbox` entry naming requester, approver, subject,
date, kind, target and reason in this transaction, following the
existing attendance export audit shape. All effects remain atomic.

For `confirm-as-is`, do not materialize a new day; lock the named open
review item and require
`organization_id`, `user_id`, `work_date`, and `id` to match the
correction. Resolve it with `resolution_source='human'`,
`resolved_by`, and `correction_id`; require exactly one updated row
or return 422. It writes no event or recalculation request.

- [ ] **Step 6: Grouped creation**

`bulkCorrection` sorts and de-duplicates the already validated
subject IDs, authorizes every subject with the work date, and inserts
one pending `add-event` correction per person under a common
`batch_id` in one creation transaction. Atomic batch approval,
ascending multi-person locks and cross-person punch movement remain
the explicit AT-11 follow-up; the response must describe the batch as
pending items, not an approved unit.

- [ ] **Step 7: Typecheck and commit**

```bash
npx tsc -p packages/server/tsconfig.json --noEmit
npx vitest run packages/server/src/modules/attendance/correction.test.ts
git add packages/server/src/modules/attendance/correction.ts \
        packages/server/src/modules/attendance/correction.test.ts \
        packages/server/src/modules/attendance/events.ts \
        packages/server/src/modules/attendance/ledger.ts
git commit -m "feat(attendance): individual correction workflow with dated authorization"
```

---

### Task 8: Correction routes

**Files:**
- Modify: `packages/server/src/modules/attendance/routes.ts`

- [ ] **Step 1: Add imports**

```typescript
import {
  raiseCorrection, requestCorrection, approveCorrection, bulkCorrection,
} from './correction.js';
import {
  raiseCorrectionSchema, requestCorrectionSchema, approveSchema, bulkCorrectionSchema,
} from './validators.js';
```

- [ ] **Step 2: Add correction resource loader**

Inside `registerAttendanceRoutes`, before the `route(...)` calls:

```typescript
// The loader supplies both A1's initiator and P9's organization-local date.
async function loadCorrectionResource(ctx: RequestContext, id: string): Promise<Resource | null> {
  return db.transaction(ctx, async (tx) => {
    const row = await tx.maybeOne<Resource>(sql`
      SELECT 'attendanceCorrection' AS type, c.id, c.user_id AS "userId",
             c.organization_id AS "organizationId", c.work_date::text AS "workDate",
             c.requested_by AS "requestedBy",
             u.department_id AS "departmentId", u.team_id AS "teamId"
      FROM attendance_correction c
      JOIN app_user u ON u.id = c.user_id AND u.organization_id = c.organization_id
      WHERE c.id = ${id}
    `);
    return row === null ? null : { ...row, organizationToday: await organizationToday(tx) };
  });
}
```

Import `organizationToday` from `../../platform/organization-time.js`.
The service repeats authorization after locking the correction, so a
placement/status change between loader and handler cannot bypass scope,
A1 or P9.

- [ ] **Step 3: Register the 4 routes**

Note: `/corrections/request` and `/corrections/bulk` must be registered before `/corrections/:id` to avoid the literal path segments matching `:id`.

```typescript
  route({
    method: 'POST', path: '/api/attendance/corrections/request',
    action: 'attendance:request-correction', module: 'attendance', status: 201,
    handler: async ({ ctx, body }) => requestCorrection(ctx, requestCorrectionSchema.parse(body)),
  });

  route({
    method: 'POST', path: '/api/attendance/corrections/bulk',
    action: 'attendance:raise-correction', module: 'attendance', status: 201,
    handler: async ({ ctx, body }) => bulkCorrection(ctx, bulkCorrectionSchema.parse(body)),
  });

  route({
    method: 'POST', path: '/api/attendance/corrections',
    action: 'attendance:raise-correction', module: 'attendance', status: 201,
    handler: async ({ ctx, body }) => raiseCorrection(ctx, raiseCorrectionSchema.parse(body)),
  });

  route({
    method: 'POST', path: '/api/attendance/corrections/:id/approve',
    action: 'attendance:correct', module: 'attendance',
    resourceParam: 'id', loadResource: loadCorrectionResource,
    handler: async ({ ctx, params, body }) =>
      approveCorrection(ctx, params['id']!, approveSchema.parse(body)),
  });
```

- [ ] **Step 4: Smoke-test server startup**

```bash
npx tsx --eval "import('./packages/server/src/index.js').then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); })"
```

Expected: exits 0 with no "route not in registry" error.

- [ ] **Step 5: Registry check**

```bash
npx tsx tools/ci/index.ts registry
```

Expected: all 4 new routes present and all existing checks pass.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/modules/attendance/routes.ts
git commit -m "feat(attendance): 4 correction routes with correction resource loader"
```

---

### Task 9: Mandatory PostgreSQL integration gate

**Files:**
- Create: `packages/server/src/modules/attendance/correction.integration.test.ts`

- [ ] **Step 1: Build fixtures against the actual APIs**

Follow `attendance-api.integration.test.ts` and
`ledger.integration.test.ts`: use `randomUUID`, `platformDb.query`
with `sql` for tenant-root fixtures, `db.transaction` with `sql`
for tenant work, `createRequestContext` for employee principals,
`installAuthz()`, `registerAttendancePolicies()`, and
`closePools()` in cleanup. Do **not** import
`../../test/helpers.js`: that file and its proposed builders do not
exist. Do not call `db.maybeOne(ctx, string, params)`; this DAL accepts
one tagged `sql` fragment.

Create four valid UUID employees in one organization: subject,
requester/HR1, approver/HR2, and Super Admin. Seed their departments,
positions and `position_policy` grants as the existing attendance API
test does. HR1 needs `attendance:raise-correction`; HR2 needs
`attendance:correct`, and employee requests need
`attendance:request-correction`. Use a real second department for
out-of-scope cases. Create
the subject's event via `appendEvent`, so it has an assignment; a bare
`repo.insertEvent` is not a valid fixture for a target-day test.
Build the date from an injectable fixed `Clock` and the tenant zone;
for tests that exercise the HTTP resource loader, compute a separate
old date from actual `organizationToday`. Never label a fixed
`2026-12-15 - 65 days` value “65 days ago” relative to the machine
clock.

The file has **no** `describe.skipIf`. Run it alone with
`TAPCRM_INTEGRATION_DB=1`, `MIGRATION_DATABASE_URL`, and
`DATABASE_URL` pointing at the migrated test database. A missing
database fails this gate.

- [ ] **Step 2: Exercise correction and authorization paths**

Required cases:

1. HR1 raises add-event for the subject; HR2 approves; assert the
   event is `source='correction'`, pinned to the requested date, and
   correction status is approved. Assert one `correction.decided`
   domain-outbox row and one audit-outbox row with the two actors.
2. Requester HR1 and the subject each fail to approve before any event
   is written (A1/G4). HR2 succeeds. Repeat through the HTTP loader
   for A1's `requestedBy`. Verify raise and bulk reach their handlers
   under the non-approval-bearing proposal action.
3. Ordinary HR2 is denied at 61 organization-local days, and allowed
   at 60; Super Admin approves a 61-day correction **requested by
   HR1**, both through direct service calls and the HTTP route.
4. Raise, request and grouped bulk creation apply P9 to their
   `workDate`. Out-of-scope raise/bulk fail before any row is
   inserted; pool scope uses `poolMemberIds`.
5. A second void of an already superseded event, and a void targeting
   another work date, return 422
   `CORRECTION_TARGET_SUPERSEDED`.
6. An out before arrival, an out in arrival's second, and an event
   after departure return 422 `CORRECTION_NOT_READABLE`. A
   correction outside the eligibility window succeeds while an
   ordinary device event outside it remains ineligible.
7. A void-only approval increments the old record's `input_version`
   and writes the matching `attendance.recalc-requested` outbox
   payload. A replacement that moves evidence across a boundary
   bumps and re-derives both old and new days.
8. `confirm-as-is` resolves the exact open item for the correction's
   person/date; another person's item and an already resolved item
   return 422 and remain untouched. The composite FK refuses an
   item linked to another person's correction.

- [ ] **Step 3: Exercise closure and runner paths**

For every case, assert `state`, `closed_by`, the effective
departure, the supersession chain, review-item state and recalculation
outbox/version. Cover all four named §12.4 deliveries: late real
departure after shift-end auto-out; whole night delivered after
no-show; late scan after a shift-end guess; and lone late arrival
after no-show. Also cover auto-out time re-derivation, a second
re-derivation of the same day, and an outer day touched by widened
attribution. Compare final days with the same events delivered on time.

Exercise `applyCloseDecision` on a working day whose resolved shift is
`kind: 'none'` and whose `shiftEnd` is `null`. After the cap, prove that
no events derive no-show, an arrival without a departure derives a
last-event auto-out, and a real out derives real-departure. Do not use
the calculator's `not-evaluated` status to bypass these closure checks.

Open an `auto-close-failed` item for an old input version, then refresh
the shift facts so the new `closingCap` is later than the injected
clock and re-derive the day. Assert the answer is `still-open`, the
record remains open with `closed_by = NULL`, and the old failure item
is resolved in the same successful transaction. Also assert a forced
rollback leaves the item open.

Exercise the actual auto-close scan/item path with `job_run` and
Step 0's `nextGeneration`: three attempts per generation, a
24-hour wait, at most three generations, and a persisted
`auto-close-failed` item after exhaustion. Force a rollback inside
the item transaction and prove the later scan's successful
transaction persists the review item. A standalone boolean expression
or manual second insert is not sufficient.

- [ ] **Step 4: Run the gate and commit**

```bash
TAPCRM_INTEGRATION_DB=1 npx vitest run \
  packages/server/src/modules/attendance/correction.integration.test.ts
git add packages/server/src/modules/attendance/correction.integration.test.ts
git commit -m "test(attendance): correction and closure PostgreSQL gate"
```

No expected fixed test count: add every case above and require all to
pass. Record the count in the implementation PR/summary.

---

### Task 10: Final gates and scoped handoff

- [ ] **Step 1: Typecheck**

```bash
npx tsc -p packages/server/tsconfig.json --noEmit
npx tsc -p packages/contracts/tsconfig.json --noEmit
```

- [ ] **Step 2: Full CI suite**

After migration and typecheck, run the established complete CI gate,
which checks more than the route registry:

```bash
npm run ci
```

All blocking checks must pass. Report any phased findings explicitly;
do not treat a registry-only command as the CI result.

- [ ] **Step 3: Unit and non-integration suite**

```bash
npx vitest run packages/server/src/modules/attendance/close.test.ts \
               packages/server/src/modules/attendance/day-facts.test.ts \
               packages/server/src/modules/attendance/correction.test.ts
npx vitest run --exclude packages/server/src/modules/attendance/correction.integration.test.ts
```

The new PostgreSQL file has no `skipIf`; explicitly exclude it from
this non-integration run. Existing integration files may use their
established `TAPCRM_INTEGRATION_DB` gate.

- [ ] **Step 4: Registry extraction and server startup**

```bash
npm run registry:extract -- --check
npx tsx --eval "import('./packages/server/src/index.js').then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); })"
```

Require the four planned correction routes. Their presence in the
registry proves binding, not authorization behavior; Task 9 covers
that through the loader and service.

- [ ] **Step 5: Mandatory PostgreSQL gates**

```bash
TAPCRM_INTEGRATION_DB=1 npx vitest run \
  packages/server/src/modules/attendance/correction.integration.test.ts \
  packages/server/src/platform/modules/people-privileges.integration.test.ts
```

Run the migration on the **test** database first. All Task 9 cases and
the exact app-role privilege assertions for both new tables must pass;
a connection error or a missing fixture is a failing gate.

- [ ] **Step 6: Lint and diff check**

```bash
npx eslint packages/server/src/modules/attendance/close.ts \
           packages/server/src/modules/attendance/day-facts.ts \
           packages/server/src/modules/attendance/repository.ts \
           packages/server/src/modules/attendance/ledger.ts \
           packages/server/src/modules/attendance/recalculate.ts \
           packages/server/src/modules/attendance/jobs.ts \
           packages/server/src/modules/attendance/errors.ts \
           packages/server/src/modules/attendance/events.ts \
           packages/server/src/modules/attendance/validators.ts \
           packages/server/src/modules/attendance/policy.ts \
           packages/server/src/modules/attendance/correction.ts \
           packages/server/src/modules/attendance/routes.ts
git diff --check
```

- [ ] **Step 7: Report the precise scope**

Stage only Step 7 files if another commit is needed; never use
`git add -A` in the existing worktree. Report the actual migration,
typecheck, full CI, unit, registry extraction and PostgreSQL gate
results. Mark this
**individual-correction and auto-close core** done only when those
gates pass. Keep the follow-up obligations below open.

---

## Review of the previously reported blockers

| Finding | Required plan change |
|---|---|
| Raise/bulk denied before the handler by A1 | Task 0 adds `attendance:raise-correction` as a non-approval-bearing action and backfills proposal grants; `attendance:correct` remains approval-bearing for decisions. |
| D32 same-second contradiction | Task 2 uses `compareEvents` to decide whether anything follows the last scan and requires shift-end for the same-second break-start case. |
| Closed records cannot change `closed_by` | Task 3 replaces open-only `closeRecord` with `setRecordClosure`; Task 4 applies it to open and closed records. |
| AT-10 missing on creation and direct approval | Tasks 6–8 pass `workDate` and organization-local today on every resource, and authorize the locked approval in the service. Tests use separate 60/61-day boundaries. |
| Pool IDs compared with team IDs | Task 6 uses `poolMemberIds` and filters `u.id`; the existing `ResourcePolicy.check(ctx, action, resource, scope)` signature is confirmed. |
| Confirm-as-is could close another person's item | Task 1 adds the composite same-person FK; Task 7 locks and verifies item, user and date before resolving. |
| A1 fixtures self-approve | Task 9 uses separate subject, requester and approver; both engine A1 and the service guard run before effects. |
| Correction may miss version/outbox | Task 4 accepts explicit touched record IDs; Task 7 supplies old and new records; Task 9 asserts the new version and outbox payload for void-only and cross-day changes. |
| Actual shift end conflated with closingCap | Task 2 accepts them separately; Task 4 adds `DayFacts.shiftEnd` from fixed-shift geometry. |
| Generations omitted from hourly scan | Task 5 calls Step 0's `nextGeneration`, then writes the failure item after generation three is exhausted. |
| Proposed PostgreSQL fixture could not compile | Task 9 uses existing DAL, context, authz and fixture patterns and has a mandatory, unskipped database gate. |
| Nullable eligibility contradicted the flexible-day test | Task 2 makes `window: EligibilityWindow \| null` explicit and tests all no-shift closure answers. |
| No-shift days skipped during closure | Task 4 evaluates working no-shift days with `shiftEnd = null`; Task 9 checks the effectful state changes. |
| Successful still-open re-derivation leaves `auto-close-failed` stale | Task 4 resolves that item after every successful derivation; Task 9 checks both commit and rollback. |
| New table privileges and full CI were outside the gates | Task 1 pins both tables in the People privilege integration test; Task 10 runs `npm run ci` and the database privilege gate. |

## Open roadmap obligations after this core plan

These are **not** silently considered complete by Task 10:

- **AT-11 atomic batch approval:** grouped creation is pending-only.
  A follow-up must add batch approval, ascending multi-person advisory
  locks, all-or-nothing effects, and the cross-person punch movement
  workflow in §12.1.
- **G8 list and reject:** the registry currently has neither route;
  settle G8 with the owners, then plan and register both.
- **Biometric clock retime:** `retime-device-events` remains in the
  step 5 biometric retime path with its subject-change checks.
- **Frozen/published reconciliation:** the payroll integration step
  must raise `reconciled-from-auto-close`, preserve frozen snapshots,
  flag payslips, and block publishing until review (§12.4, PY-7).
- **Other review-item producers:** punch, holiday, leave, WFH and
  biometric owners must wire their listed review kinds; creating the
  table alone does not close those requirements.

The attendance roadmap's Step 7 status must stay **in progress**
until these obligations either land or are explicitly assigned to
named later steps with their own gates. This document's exit criteria
cover only the core stated at the top.
