# Sales Management v1.1 — R0 + R1 Implementation Plan

**Spec:** `2026-10-05-sales-management-prd-v1.1.md`
**Date:** 2026-10-05
**Covers:** Increments R0 (Foundation) and R1 (Reliable lead operations with bidding)
**Out of scope here:** R2 Deals, R3 Proposals/approvals, R4 Receipts + Targets, R5 Reporting

---

## Overview

R0 lays the entity, policy, availability and real-time plumbing. R1 ships five source adapters, the bidding pool, the My Work screen, the triage queue, reassignment and imports.

A pilot cutover is possible after R1. No Deal / Proposal / Target behaviour ships here — those live in R2–R4.

### R0 — Foundation (estimated 4–5 engineering weeks)

| # | Step | Primary artefacts |
|---|---|---|
| 0.1 | Contact + Company first-class entities | migration 0075 |
| 0.2 | Lead schema extensions for bidding + attribution | migration 0076 |
| 0.3 | LeadSubmission + BidPoolView + Connector tables | migration 0077 |
| 0.4 | Availability facade (attendance + break + leave + live-status) | `platform/availability/*` |
| 0.5 | Policy registry extensions for new actions | `platform/authz/sales-actions.ts` |
| 0.6 | Dual-clock timezone helpers | `platform/time/clocks.ts` |
| 0.7 | Realtime channel for bid pool + lead events | `platform/realtime/sales-channel.ts` |
| 0.8 | Outbox topics + intake worker scaffolding | `platform/outbox/sales-topics.ts` |

### R1 — Lead operations with bidding (estimated 8–12 engineering weeks)

| # | Step | Primary artefacts |
|---|---|---|
| 1.1 | Canonical intake service | `modules/sales/intake/*` |
| 1.2 | Dedupe engine (phone + email + submission key) | `modules/sales/intake/dedupe.ts` |
| 1.3 | Bidding pool state machine + claim API | `modules/sales/bidding/*` |
| 1.4 | Direct-assignment router rebuild (fallback) | `modules/sales/routing/*` |
| 1.5 | Reassignment service (HOD + Super Admin) | `modules/sales/leads/reassign.ts` |
| 1.6 | Website intake adapter | `modules/sales/adapters/website/*` |
| 1.7 | Meta Lead Ads adapter + reconciliation worker | `modules/sales/adapters/meta/*` |
| 1.8 | Email mailbox adapter (Google + Microsoft) | `modules/sales/adapters/email/*` |
| 1.9 | WhatsApp provider-agnostic adapter | `modules/sales/adapters/whatsapp/*` |
| 1.10 | Google Business Profile (Exotel) adapter | `modules/sales/adapters/gbp/*` |
| 1.11 | CSV / XLSX import pipeline | `modules/sales/imports/*` |
| 1.12 | Manual entry drawer refactor | `client/.../AddLeadDrawer.tsx` |
| 1.13 | Bid Pool page + card component | `client/.../BidPool/*` |
| 1.14 | My Work screen | `client/.../MyWork/*` |
| 1.15 | Lead detail refactor + reassign UI | `client/.../LeadDetail/*` |
| 1.16 | Triage queue (manager view) | `client/.../Triage/*` |
| 1.17 | Fairness guard enforcement + supervisor dashboard | server + client |
| 1.18 | Activities enhancements (callback owner fix, missing types) | `modules/sales/leads/callback-*` |

Each step has (a) migration if applicable, (b) server module, (c) client module, (d) tests, (e) acceptance criteria.

---

## Phase R0 — Foundation

### Step 0.1 — Migration: Contact + Company entities

**File:** `migrations/0075_sales_contact_company.sql`

Promote contact and company to first-class entities. Lead gains a FK to contact; existing `contact_name`, `company_name`, `phone`, `email` columns on `lead` stay for backward compatibility and are backfilled, but new writes go through contact/company.

```sql
CREATE TABLE contact (
  id                   uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id      uuid NOT NULL,
  full_name            text,
  primary_phone        text,           -- E.164
  primary_phone_raw    text,
  primary_email        text,
  company_id           uuid REFERENCES company(id) ON DELETE SET NULL,
  preferred_timezone   text,           -- derived; defaults to 'Asia/Kolkata'
  preferred_channel    text CHECK (preferred_channel IN ('phone','email','whatsapp','sms')),
  consent              jsonb NOT NULL DEFAULT '{}'::jsonb,
  opt_out              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, primary_phone) DEFERRABLE INITIALLY DEFERRED,
  UNIQUE (organization_id, primary_email) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX ON contact (organization_id, primary_phone);
CREATE INDEX ON contact (organization_id, primary_email);

CREATE TABLE company (
  id                   uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id      uuid NOT NULL,
  name                 text NOT NULL,
  domain               text,
  billing_reference    text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON company (organization_id, lower(name));
CREATE INDEX ON company (organization_id, domain);

ALTER TABLE lead
  ADD COLUMN contact_id uuid REFERENCES contact(id),
  ADD COLUMN company_id uuid REFERENCES company(id);
CREATE INDEX ON lead (organization_id, contact_id);
CREATE INDEX ON lead (organization_id, company_id);

-- Backfill contact rows from existing lead data; one contact per (org, phone) or (org, email).
INSERT INTO contact (organization_id, full_name, primary_phone, primary_email, created_at, updated_at)
SELECT DISTINCT ON (l.organization_id, COALESCE(l.phone, l.email::text))
       l.organization_id, l.contact_name,
       NULLIF(l.phone, ''), NULLIF(l.email::text, ''),
       l.created_at, l.updated_at
FROM lead l
WHERE l.phone IS NOT NULL OR l.email IS NOT NULL
ORDER BY l.organization_id, COALESCE(l.phone, l.email::text), l.created_at;

-- Link leads to the newly created contacts.
UPDATE lead l SET contact_id = c.id
FROM contact c
WHERE c.organization_id = l.organization_id
  AND ((l.phone IS NOT NULL AND c.primary_phone = l.phone)
    OR (l.email IS NOT NULL AND c.primary_email = l.email::text));
```

**Server module:** `packages/server/src/modules/sales/contacts/` (new) and `.../companies/` (new) with repository + validators + policy.

**Client module:** no UI changes yet; existing lead screens continue to read `contact_name`, `company_name` columns.

**Tests:**
- `contacts/repository.test.ts` — creation, lookup by phone/email, duplicate rejection.
- Migration dry-run on a cloned production dataset: no duplicate contacts, every lead with phone/email has a `contact_id`.

**Acceptance:** every pre-migration lead with contact info has a `contact_id`. Duplicate phones/emails are collapsed into one contact row with the earliest `created_at`.

---

### Step 0.2 — Migration: Lead schema for bidding + attribution

**File:** `migrations/0076_sales_lead_bidding.sql`

```sql
ALTER TABLE lead
  ADD COLUMN entry_method text NOT NULL DEFAULT 'manual'
    CHECK (entry_method IN ('manual','website','provider_webhook','provider_poll','import','partner_api')),
  ADD COLUMN direction text NOT NULL DEFAULT 'inbound'
    CHECK (direction IN ('inbound','outbound')),
  ADD COLUMN originating_agent_id uuid REFERENCES app_user(id),
  ADD COLUMN claimed_at timestamptz,
  ADD COLUMN bid_state text NOT NULL DEFAULT 'none'
    CHECK (bid_state IN ('none','pool_open','claimed','triage','fallback_assigned')),
  ADD COLUMN bid_pool_opened_at timestamptz,
  ADD COLUMN bid_pool_expires_at timestamptz,
  ADD COLUMN sla_first_contact_due_at timestamptz,
  ADD COLUMN lead_stage text NOT NULL DEFAULT 'new'
    CHECK (lead_stage IN ('new','contacted','discovery','qualified')),
  ADD COLUMN lead_outcome text NOT NULL DEFAULT 'active'
    CHECK (lead_outcome IN ('active','nurture','converted','closed_lost','archived')),
  ADD COLUMN qualified_at timestamptz,
  ADD COLUMN converted_at timestamptz;

CREATE INDEX ON lead (organization_id, bid_state) WHERE bid_state IN ('pool_open','triage');
CREATE INDEX ON lead (organization_id, originating_agent_id);
CREATE INDEX ON lead (organization_id, sla_first_contact_due_at) WHERE lead_outcome = 'active';

-- Backfill originating_agent_id from owner_id for existing leads.
UPDATE lead SET originating_agent_id = owner_id WHERE originating_agent_id IS NULL AND owner_id IS NOT NULL;

-- Backfill lead_stage from legacy status per PRD §9.2 migration map.
UPDATE lead SET lead_stage = CASE status
  WHEN 'new' THEN 'new'
  WHEN 'assigned' THEN 'new'
  WHEN 'contacted' THEN 'contacted'
  WHEN 'discovery' THEN 'discovery'
  WHEN 'proposal_sent' THEN 'discovery'
  WHEN 'follow_up' THEN 'contacted'
  WHEN 'callback_scheduled' THEN 'contacted'
  WHEN 'nurture' THEN 'contacted'
  WHEN 'converted' THEN 'qualified'
  WHEN 'closed_lost' THEN 'contacted'
  ELSE 'new'
END;

UPDATE lead SET lead_outcome = CASE status
  WHEN 'nurture' THEN 'nurture'
  WHEN 'converted' THEN 'converted'
  WHEN 'closed_lost' THEN 'closed_lost'
  ELSE 'active'
END;
```

**Server changes:**
- `modules/sales/leads/types.ts` — add new fields to `Lead` interface.
- `modules/sales/leads/repository.ts` — update `LEAD_SELECT` to include new columns.
- `modules/sales/leads/service.ts` — leave legacy `status` writes intact; new code writes `lead_stage` + `lead_outcome` and reconciles `status` for backward compatibility.

**Tests:**
- `lifecycle.test.ts` — verify every legacy status maps to a `(lead_stage, lead_outcome)` tuple without ambiguity.
- Repository test confirming new fields round-trip.

**Acceptance:** no row has `originating_agent_id = NULL AND owner_id IS NOT NULL`; every row has non-null `lead_stage` and `lead_outcome`.

---

### Step 0.3 — Migration: LeadSubmission + BidPoolView + Connector

**File:** `migrations/0077_sales_intake_connectors.sql`

```sql
CREATE TABLE sales_connector (
  id                     uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id        uuid NOT NULL,
  kind                   text NOT NULL
    CHECK (kind IN ('website','meta','email','whatsapp','gbp','import','partner')),
  name                   text NOT NULL,
  external_account_id    text,           -- e.g. Meta Page ID, Gmail address, WABA ID
  external_form_ids      text[],         -- Meta forms, website form IDs
  config                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  secret_ref             text,           -- opaque pointer into secret store
  status                 text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','testing','active','degraded','reconnect_required','paused','disconnected')),
  cursor                 jsonb,
  last_success_at        timestamptz,
  last_test_at           timestamptz,
  last_reconcile_at      timestamptz,
  queue_lag_seconds      integer,
  captured_count         integer NOT NULL DEFAULT 0,
  linked_count           integer NOT NULL DEFAULT 0,
  quarantined_count      integer NOT NULL DEFAULT 0,
  current_error          text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, kind, external_account_id)
);
CREATE INDEX ON sales_connector (organization_id, kind, status);

CREATE TABLE lead_submission (
  id                     uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id        uuid NOT NULL,
  connector_id           uuid REFERENCES sales_connector(id) ON DELETE SET NULL,
  external_lead_id       text,
  external_form_id       text,
  mapping_version        text,
  provider_submitted_at  timestamptz,
  source_received_at     timestamptz NOT NULL DEFAULT now(),
  first_processed_at     timestamptz,
  raw_payload_encrypted  bytea,          -- encrypted at rest; retention 30d
  raw_payload_digest     text,           -- for dedup / debugging without reading content
  normalized_payload     jsonb,
  outcome                text NOT NULL DEFAULT 'pending'
    CHECK (outcome IN ('pending','created','linked_existing','duplicate_delivery','quarantined','rejected','failed_retryable')),
  outcome_reason         text,
  lead_id                uuid REFERENCES lead(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now()
);
-- Idempotency key per PRD R-DUP-01.
CREATE UNIQUE INDEX uniq_submission_external_key
  ON lead_submission (organization_id, connector_id, external_lead_id)
  WHERE external_lead_id IS NOT NULL;
CREATE INDEX ON lead_submission (organization_id, outcome, source_received_at DESC);

CREATE TABLE bid_pool_view (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id    uuid NOT NULL,
  lead_id            uuid NOT NULL REFERENCES lead(id) ON DELETE CASCADE,
  agent_id           uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  action             text NOT NULL DEFAULT 'viewed'
    CHECK (action IN ('viewed','passed','claimed')),
  pass_reason        text,           -- NULL unless action = 'passed'
  pass_until         timestamptz,    -- NULL unless action = 'passed'; enforces 5-min cooling
  UNIQUE (lead_id, agent_id)
);
CREATE INDEX ON bid_pool_view (organization_id, lead_id, action);
CREATE INDEX ON bid_pool_view (organization_id, agent_id, action);

CREATE TABLE sales_routing_decision (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id    uuid NOT NULL,
  lead_id            uuid NOT NULL REFERENCES lead(id) ON DELETE CASCADE,
  mode               text NOT NULL
    CHECK (mode IN ('bidding','direct','fallback','reassignment')),
  rules_version      text,
  candidate_snapshot jsonb,
  result             jsonb,
  reason             text,
  actor_id           uuid REFERENCES app_user(id),
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON sales_routing_decision (organization_id, lead_id, created_at DESC);
```

**Server modules:** `modules/sales/intake/`, `modules/sales/connectors/`.

**Tests:**
- Unique index: concurrent inserts with the same `(organization_id, connector_id, external_lead_id)` → one succeeds, one gets `UniqueViolation`.
- Raw payload encryption round-trip (encrypt → store → fetch → decrypt).

**Acceptance:** two attempts to replay the same provider webhook result in exactly one `lead_submission` row and one `lead` row.

---

### Step 0.4 — Availability facade

**Files:**
- `packages/server/src/platform/availability/index.ts` — public interface
- `packages/server/src/platform/availability/service.ts` — implementation
- `packages/server/src/platform/availability/types.ts`
- `packages/server/src/platform/availability/service.test.ts`

```ts
// types.ts
export interface AvailabilityResult {
  userId: string;
  eligible: boolean;
  reasons: Array<'not_active' | 'not_punched_in' | 'on_break' | 'on_leave' | 'presence_offline' | 'at_capacity' | 'cooling_period' | 'daily_cap_hit' | 'service_unavailable'>;
  activeLeadCount: number;
  claimsToday: number;
}

export interface AvailabilityOptions {
  pool?: 'bidding' | 'direct' | 'handover';
  caps?: {
    activeLeadMax?: number;      // default 20
    dailyClaimMax?: number;      // default null (no cap)
  };
}
```

```ts
// service.ts (sketch)
export async function evaluateAvailability(
  ctx: RequestContext,
  userIds: string[],
  opts: AvailabilityOptions = {},
): Promise<AvailabilityResult[]> {
  // Query attendance (punched in), break-management (active break), leave (approved day),
  // live-status (presence), lead counts, bid-pool claims today.
  // Fail closed: if any upstream service errors, return eligible: false with reason 'service_unavailable'.
}
```

**Integrations:** reads from `attendance_sessions`, `breaks`, `leave_requests`, `live_status_presence`, `lead` tables. All via existing module repositories (not direct SQL).

**Tests:**
- Agent on break → `eligible: false, reasons: ['on_break']`.
- Agent at 20 active leads with default cap → `at_capacity`.
- Attendance service throws → `eligible: false, reasons: ['service_unavailable']` (fail-closed).

**Acceptance:** `evaluateAvailability([userA, userB, userC])` returns 3 results in < 100 ms p95.

---

### Step 0.5 — Policy registry extensions

**File:** `packages/server/src/modules/sales/sales-actions.ts` (new)

Register the new actions with `@tapcrm/authz`:

```ts
export const SALES_ACTIONS = {
  LEAD_CLAIM:               'sales.lead.claim',
  LEAD_PASS:                'sales.lead.pass',
  LEAD_REASSIGN:            'sales.lead.reassign',
  LEAD_REASSIGN_WITH_CREDIT:'sales.lead.reassign-with-credit',
  LEAD_RESCUE_FROM_TRIAGE:  'sales.lead.triage.rescue',
  INTAKE_RETRY_FAILED:      'sales.intake.retry',
  INTAKE_PAUSE_CONNECTION:  'sales.intake.pause',
  INTAKE_CONFIGURE:         'sales.intake.configure',
} as const;
```

Default role bindings (updated for v1.1):

| Action | Roles |
|---|---|
| `LEAD_CLAIM` | `sales_agent`, `sales_supervisor`, `sales_team_lead` |
| `LEAD_PASS` | same as claim |
| `LEAD_REASSIGN` | `sales_hod`, `super_admin` |
| `LEAD_REASSIGN_WITH_CREDIT` | `super_admin` only |
| `LEAD_RESCUE_FROM_TRIAGE` | `sales_supervisor` (own pool), `sales_hod`, `super_admin` |
| `INTAKE_*` | `super_admin` (initial); `sales_hod` for pause only |

**Tests:**
- `sales-actions.test.ts` — authorizing an agent for `LEAD_REASSIGN` returns denied.

---

### Step 0.6 — Dual-clock timezone helpers

**File:** `packages/server/src/platform/time/clocks.ts` (new)

```ts
import { DateTime } from 'luxon';

export const OPERATIONAL_TZ = 'Asia/Kolkata';   // L7

export function nowOperational(): DateTime {
  return DateTime.now().setZone(OPERATIONAL_TZ);
}

// Business-time arithmetic: skip weekends, honour tenant shifts/holidays (reads org config).
export async function addBusinessMinutes(ctx: RequestContext, from: DateTime, minutes: number): Promise<DateTime>;

// Pick the right clock for a given lead or contact.
export async function resolveCustomerTimezone(ctx: RequestContext, contactId: string): Promise<string>;

// Derivation order per PRD R-TZ-02: explicit → phone country code → IP geoloc → fallback.
export function deriveTimezoneFromPhone(e164: string): string | null;
export function deriveTimezoneFromIP(ip: string): string | null;   // may call cached geoip DB
```

**Tests:**
- `addBusinessMinutes` with Sat/Sun input moves to Monday 10:00 IST.
- `resolveCustomerTimezone` for `+91 98xx…` → `Asia/Kolkata`.
- `resolveCustomerTimezone` for `+971 50xx…` → `Asia/Dubai`.
- Explicit override on contact wins over phone-derived.

---

### Step 0.7 — Realtime channel for bid pool

**File:** `packages/server/src/platform/realtime/sales-channel.ts` (new)

Uses the existing Socket.IO + Redis adapter. Namespaces:

- `/sales/bid-pool/<poolId>` — one room per pool. Eligible agents subscribe on login + pool change.
- `/sales/lead/<leadId>` — per-lead events (claimed, reassigned) for live detail views.

Events emitted:

| Event | Payload | Receivers |
|---|---|---|
| `bid-pool.added` | `{ leadId, maskedCard }` | all eligible agents in that pool |
| `bid-pool.removed` | `{ leadId, reason }` | same |
| `bid-pool.viewer-count` | `{ leadId, count }` (debounced 10s) | same |
| `lead.claimed` | `{ leadId, claimedBy }` | lead-detail subscribers |
| `lead.reassigned` | `{ leadId, from, to, reason }` | lead-detail subscribers |

**Client:** `packages/client/src/company/sales/realtime/useBidPool.ts` hook.

**Tests:** integration — subscribe two sockets as eligible agents, publish `bid-pool.added`, both receive within 50 ms.

---

### Step 0.8 — Outbox topics + intake worker scaffolding

Add BullMQ queues:

- `sales.intake.ingest` — one job per raw submission; worker runs the intake pipeline.
- `sales.intake.reconcile` — scheduled every 15 min per active Meta connection.
- `sales.bid-pool.expire` — delayed job per `pool_open` lead, scheduled for its `bid_pool_expires_at`.
- `sales.outbox.notify-agents` — WebSocket + push notification fanout.

**Files:**
- `modules/sales/intake/workers/ingest-worker.ts`
- `modules/sales/intake/workers/meta-reconcile-worker.ts`
- `modules/sales/bidding/workers/expire-worker.ts`

**Tests:** worker-level unit tests for each (idempotent on job ID, retries respect backoff).

---

## Phase R1 — Lead operations with bidding

### Step 1.1 — Canonical intake service

**Files:**
- `modules/sales/intake/service.ts`
- `modules/sales/intake/mapper.ts`
- `modules/sales/intake/validator.ts`
- `modules/sales/intake/outcome.ts`
- `modules/sales/intake/service.test.ts`

```ts
export interface IntakePayload {
  connectorId: string;
  externalLeadId?: string;
  externalFormId?: string;
  providerSubmittedAt?: Date;
  rawPayload: Buffer;              // raw bytes for durable storage
  mappedFields: {
    contactName?: string;
    phoneRaw?: string;
    emailRaw?: string;
    serviceRequested?: string;
    location?: string;
    budgetBracket?: string;
    timeline?: string;
    message?: string;
    languagePreference?: string;
    utm?: Record<string, string>;
    [key: string]: unknown;
  };
}

export async function ingest(ctx: RequestContext, payload: IntakePayload): Promise<{
  outcome: SubmissionOutcome;
  leadId?: string;
  submissionId: string;
}>;
```

Pipeline inside `ingest()`:

1. Verify connector exists, active, same tenant → else `rejected`.
2. Encrypt + store raw payload in `lead_submission` with `outcome: 'pending'`.
3. Try insert on unique `(org, connector, externalLeadId)` → on conflict return `duplicate_delivery` with the existing `lead_id` reference.
4. Validate required fields → missing contact → `quarantined` with reason.
5. Normalise phone (libphonenumber) + email; derive contact timezone.
6. Dedupe (Step 1.2) → either `linked_existing` or new contact.
7. Match territory → resolve pool.
8. If pool has ≥ 1 eligible agent AND connector kind ∈ {website, meta, gbp, whatsapp, email-classified-as-enquiry} → mark `bid_state = 'pool_open'`, schedule expire-worker; else → direct-assignment or triage.
9. Insert `sales_routing_decision` row.
10. Insert first-contact SLA activity.
11. Update `lead_submission.outcome` + `lead_id`.
12. Emit outbox event `sales.lead.intake-completed`.

**Important integrity rules:**
- Steps 2–11 run in **one DB transaction**; raw payload encryption happens before transaction opens.
- Encryption key fetched from secret store once per worker, cached in memory.
- No provider network calls inside the transaction.

**Tests:**
- Duplicate submission with same external key → single lead.
- Missing contact → quarantined.
- Phone `9876543210` without country code → quarantined with `ambiguous_phone` reason (unless connector config specifies a default country).
- Pool has zero eligible agents → `bid_state = triage`, `routing_decision.mode = 'direct'` with reason `no_eligible_agents`.
- Pool has ≥ 1 eligible agent + external connector → `bid_state = pool_open`, expire-worker scheduled.

---

### Step 1.2 — Dedupe engine

**Files:**
- `modules/sales/intake/dedupe.ts`
- `modules/sales/intake/dedupe.test.ts`

```ts
export interface DedupeInput {
  organizationId: string;
  phoneE164?: string;
  email?: string;
  serviceRequested?: string;
}

export interface DedupeResult {
  mode: 'new_contact' | 'linked_existing_enquiry' | 'linked_existing_contact_new_enquiry';
  contactId: string;
  existingLeadId?: string;      // populated when linked_existing_enquiry
  reason: string;
}

export async function dedupeAndIdentify(tx: Tx, input: DedupeInput): Promise<DedupeResult>;
```

Logic:
1. Lookup contact by `(org, phoneE164)` or `(org, email)` within same tenant.
2. No match → create new contact → `new_contact`.
3. Match + existing **active** lead for `(contact, serviceRequested)` → `linked_existing_enquiry` with that `leadId` (per PRD R-DUP-03 default).
4. Match + different service or no active lead → `linked_existing_contact_new_enquiry`.

**Tests:**
- Same contact + same service with active lead → links to existing.
- Same contact + different service → new linked lead.
- Same contact + previously closed-lost lead on same service → new lead with `previous_lead_id`.

---

### Step 1.3 — Bidding pool state machine + claim API

**Files:**
- `modules/sales/bidding/service.ts`
- `modules/sales/bidding/routes.ts`
- `modules/sales/bidding/state.ts`
- `modules/sales/bidding/mask.ts` — contact masking for pre-claim card
- `modules/sales/bidding/service.test.ts`
- `modules/sales/bidding/routes.test.ts`

API surface:

```
GET  /api/bid-pool                        → list open bid-pool cards visible to caller
POST /api/bid-pool/:leadId/claim          → atomic claim
POST /api/bid-pool/:leadId/pass           → personal pass with reason
GET  /api/bid-pool/:leadId/card           → masked card detail (for push-notification deep links)
```

`claim` implementation (sketch, inside `BEGIN`/`COMMIT`):

```ts
export async function claim(ctx: RequestContext, leadId: string): Promise<Lead> {
  return db.tx(ctx, async (tx) => {
    const lead = await tx.maybeOne<LeadRow>(sql`
      SELECT * FROM lead
      WHERE organization_id = ${ctx.organizationId}
        AND id = ${leadId}
        AND bid_state = 'pool_open'
      FOR UPDATE
    `);
    if (!lead) {
      const other = await tx.maybeOne<{ userId: string }>(sql`
        SELECT current_holder_id AS "userId" FROM lead WHERE id = ${leadId}
      `);
      throw new BidPoolAlreadyClaimedError(maskUserRef(other?.userId));
    }

    const availability = await availabilitySvc.evaluateAvailability(ctx, [ctx.userId]);
    if (!availability[0].eligible) throw new NotEligibleError(availability[0].reasons);

    const now = DateTime.now().toUTC().toJSDate();
    const slaDue = await clocks.addBusinessMinutes(ctx, DateTime.fromJSDate(now).setZone(OPERATIONAL_TZ), 10);

    await tx.query(sql`
      UPDATE lead SET
        bid_state           = 'claimed',
        current_holder_id   = ${ctx.userId},
        owner_id            = ${ctx.userId},
        originating_agent_id = COALESCE(originating_agent_id, ${ctx.userId}),
        claimed_at          = ${now},
        routing_status      = 'assigned',
        sla_first_contact_due_at = ${slaDue.toUTC().toJSDate()},
        updated_at          = ${now}
      WHERE id = ${leadId}
    `);

    await tx.query(sql`
      INSERT INTO bid_pool_view (organization_id, lead_id, agent_id, action)
      VALUES (${ctx.organizationId}, ${leadId}, ${ctx.userId}, 'claimed')
      ON CONFLICT (lead_id, agent_id) DO UPDATE SET action = 'claimed', last_seen_at = now()
    `);

    await activityService.createCallSlaActivity(tx, { leadId, assigneeId: ctx.userId, dueAt: slaDue });
    await auditService.record(tx, { event: 'sales.bid-pool.claimed', leadId, actorId: ctx.userId });

    return fetchLead(tx, leadId);
  }).then((lead) => {
    realtime.emit('lead.claimed', { leadId: lead.id, claimedBy: ctx.userId });
    realtime.emit('bid-pool.removed', { leadId: lead.id, reason: 'claimed' });
    return lead;
  });
}
```

`pass` implementation:

```ts
export async function pass(ctx: RequestContext, leadId: string, reason: PassReason): Promise<void> {
  const until = DateTime.now().plus({ minutes: 5 }).toUTC().toJSDate();
  await db.query(ctx, sql`
    INSERT INTO bid_pool_view (organization_id, lead_id, agent_id, action, pass_reason, pass_until)
    VALUES (${ctx.organizationId}, ${leadId}, ${ctx.userId}, 'passed', ${reason}, ${until})
    ON CONFLICT (lead_id, agent_id) DO UPDATE SET action = 'passed', pass_reason = ${reason}, pass_until = ${until}, last_seen_at = now()
  `);
  realtime.emit(`agent:${ctx.userId}`, 'bid-pool.removed', { leadId, reason: 'passed' });
}
```

Expiry worker (`bid-pool.expire` queue):

```ts
export async function expireHandler(job: Job<{ leadId: string }>) {
  await db.tx(async (tx) => {
    const lead = await tx.maybeOne<LeadRow>(sql`
      SELECT * FROM lead WHERE id = ${job.data.leadId} AND bid_state = 'pool_open' FOR UPDATE
    `);
    if (!lead) return;                                      // already claimed or triage
    // Try fallback: direct-assignment router expanded to parent pool.
    const assigned = await directRouter.assignOneExpandedPool(tx, lead);
    if (assigned) {
      await tx.query(sql`
        UPDATE lead SET bid_state = 'fallback_assigned', owner_id = ${assigned.userId},
                        current_holder_id = ${assigned.userId}, originating_agent_id = ${assigned.userId},
                        claimed_at = now(), routing_status = 'assigned'
        WHERE id = ${lead.id}
      `);
      await auditService.record(tx, { event: 'sales.bid-pool.fallback', leadId: lead.id, actorId: null, metadata: { reason: 'timeout' } });
    } else {
      await tx.query(sql`UPDATE lead SET bid_state = 'triage' WHERE id = ${lead.id}`);
      await notifications.alertTriage(tx, { leadId: lead.id, reason: 'no_eligible_agents_after_timeout' });
    }
  });
}
```

Masking helpers (`mask.ts`):

```ts
export function maskName(fullName: string): string;        // 'Rahul Shah' → 'R••••• S••••'
export function maskPhone(e164: string): string;           // '+919876543210' → '+91 98••••••10'
export function maskEmail(email: string): string;          // 'rahul@example.com' → 'r••••@example.com'
export function truncateMessage(msg: string, max = 80): string;
```

**Tests:**
- Two concurrent claims via two DB transactions → one commits, one receives `BidPoolAlreadyClaimedError`.
- Pass sets `pass_until`; a reseed of the pool before `pass_until` does not re-add the card to that agent.
- Expire worker runs on a `pool_open` lead with no eligible fallback → `bid_state = triage` + triage notification.
- Expire worker runs on an already-claimed lead → no-op.

---

### Step 1.4 — Direct-assignment router rebuild

**Files:**
- `modules/sales/routing/direct-router.ts` (new, replaces current `router.ts`)
- `modules/sales/routing/capacity.ts`
- `modules/sales/routing/direct-router.test.ts`

```ts
export async function assignOne(tx: Tx, lead: Lead, opts?: { excludeAgentIds?: string[]; expandToParentPool?: boolean }): Promise<AssignmentResult | null>;
```

- Pulls territory pool from `lead.sales_pool_id`.
- Calls availability facade for all pool members.
- Computes workload: `activeLeadCount` + `overdueActivityCount` (weighted) per agent.
- Picks fewest workload with stable tie-break (`lower(user_id)`).
- Atomically increments a per-agent capacity counter inside the transaction to prevent two concurrent routes picking the same agent.

**Tests:**
- Four leads arriving simultaneously to a pool of 2 agents → each gets 2 after settling (fairness within transaction isolation).
- Round-robin flag remains **disabled**; tests confirm it throws `UNIMPLEMENTED` if explicitly requested.

---

### Step 1.5 — Reassignment service

**Files:**
- `modules/sales/leads/reassign.ts`
- `modules/sales/leads/reassign.test.ts`
- `modules/sales/leads/routes.ts` — add `POST /api/leads/:id/reassign`

```ts
export interface ReassignInput {
  leadId: string;
  newOwnerId: string;
  reason: string;
  transferPendingCallbacks: boolean;
  transferScheduledActivities: boolean;
  transferSourcingCredit: boolean;
}

export async function reassign(ctx: RequestContext, input: ReassignInput): Promise<Lead>;
```

Behaviour:
- Authorization: caller must have `LEAD_REASSIGN`; `transferSourcingCredit = true` additionally requires `LEAD_REASSIGN_WITH_CREDIT`.
- New owner must be eligible per availability facade (fail-soft: allow with warning if only `at_capacity`, since the HOD may be rebalancing).
- `current_holder_id` → `newOwnerId`; `originating_agent_id` only changes if `transferSourcingCredit`.
- Pending callbacks and scheduled activities reassigned per flags.
- Previous holder notified in-app.
- Audit event recorded with full before/after.

**Tests:**
- Agent attempts reassign → `403`.
- HOD reassigns, keeps credit → `original.originating_agent_id` unchanged.
- Super Admin reassigns + transfers credit → `original.originating_agent_id = new`; audit `before/after` differs.

---

### Step 1.6 — Website intake adapter

**Files:**
- `modules/sales/adapters/website/routes.ts` — `POST /api/webhooks/website/:connectorId`
- `modules/sales/adapters/website/service.ts`
- `modules/sales/adapters/website/service.test.ts`

Auth: scoped intake credential (per connector). Rate limit per connector (default 60 rpm, bursty).

Flow:
1. Validate `X-Tapcrm-Intake-Signature` HMAC over raw body using the connector's secret.
2. Validate `submissionUUID` is present (idempotency within website retries).
3. Build `IntakePayload`, enqueue to `sales.intake.ingest`.
4. Return `202 Accepted` with the submission UUID — do not block on dedupe.

**Tests:**
- Valid HMAC → 202.
- Invalid HMAC → 401; no DB row created.
- Replay of same submissionUUID → 202 + reuses the earlier submission row.

---

### Step 1.7 — Meta Lead Ads adapter + reconciliation worker

**Files:**
- `modules/sales/adapters/meta/routes.ts` — webhook endpoint
- `modules/sales/adapters/meta/retrieval.ts` — Graph API fetch
- `modules/sales/adapters/meta/reconcile.ts` — periodic sweep
- `modules/sales/adapters/meta/service.test.ts`

Webhook endpoint `POST /api/webhooks/meta`:
- Verify `X-Hub-Signature-256` using the app secret.
- Durably store the raw notification (even before fetching the lead).
- Enqueue `sales.meta.fetch-lead` with `leadgen_id`.

Fetch worker:
- Loads the connector's Page token from secret store.
- `GET https://graph.facebook.com/v<version>/<leadgen_id>?fields=field_data,created_time` with the token.
- Normalises `field_data` → `IntakePayload.mappedFields`.
- Enqueues `sales.intake.ingest`.
- On 401/403: mark connector `reconnect_required`, alert operator.

Reconcile worker (every 15 min, per active Meta connector):
- Fetches `GET /<pageId>/leadgen_forms` → each form's recent leads.
- For each `leadgen_id` not already in `lead_submission` → enqueue fetch.

**Tests:**
- Signature valid → notification stored and fetch enqueued.
- Fetch 401 → connector marked `reconnect_required`.
- Reconcile with 5 leads where 3 already exist → only 2 new fetches enqueued.

---

### Step 1.8 — Email mailbox adapter

**Files:**
- `modules/sales/adapters/email/google-driver.ts` — Gmail Pub/Sub + history-id walk
- `modules/sales/adapters/email/microsoft-driver.ts` — MS Graph subscription + delta queries
- `modules/sales/adapters/email/classifier.ts` — known-contact vs enquiry vs noise
- `modules/sales/adapters/email/service.ts`
- `modules/sales/adapters/email/service.test.ts`

Classifier rules (heuristic, deterministic — no AI in v1.1):
- Sender matches an existing `contact.primary_email` → `append_to_contact`, no new lead.
- Sender is in a known auto-reply pattern (`noreply@`, `mailer-daemon`, "Out of office" in subject) → `noise`, discard.
- Subject or body mentions a service keyword from the catalogue AND sender is unknown → `enquiry`, create lead.
- Else → `review_queue`, create lead with `bid_state = triage`.

**Tests:**
- Email from known contact → appended to their lead/deal activity timeline (no new lead).
- Email with "Out of Office" → discarded, no lead row.
- Email mentioning configured keyword from unknown sender → new lead, bid pool.
- Email with no match → triage queue.

---

### Step 1.9 — WhatsApp provider-agnostic adapter

**Files:**
- `modules/sales/adapters/whatsapp/driver.ts` — abstract driver interface
- `modules/sales/adapters/whatsapp/drivers/meta-cloud.ts`
- `modules/sales/adapters/whatsapp/drivers/interakt.ts`
- `modules/sales/adapters/whatsapp/drivers/gupshup.ts`
- `modules/sales/adapters/whatsapp/drivers/twilio.ts`
- `modules/sales/adapters/whatsapp/routes.ts` — `POST /api/webhooks/whatsapp/:provider`
- `modules/sales/adapters/whatsapp/classifier.ts`

Driver interface:

```ts
export interface WhatsAppDriver {
  readonly provider: 'meta_cloud' | 'interakt' | 'gupshup' | 'twilio';
  verifyWebhook(req: WebhookReq, secret: string): boolean;
  parseInbound(body: unknown): InboundMessage[];     // normalised shape
  sendText(connector: Connector, to: string, text: string): Promise<SendResult>;
  sendTemplate(connector: Connector, to: string, templateId: string, vars: Record<string, string>): Promise<SendResult>;
}
```

Classifier — mirror of email classifier but simpler:
- Known contact → append to their timeline.
- Unknown number + first message is a question/intent → new lead.
- Unknown number + 1-word greeting ("hi") → create lead in triage until second message arrives.
- Delivery receipts, read receipts → never create leads.

Outbound send checks consent, 24h customer-service window, template approval status.

**Tests:**
- Each driver has a parser test with a captured sample payload.
- Known contact's reply does not create a new lead.
- Unknown "hi" creates a triage lead; next message with intent promotes to bid pool.
- Outbound send outside 24h window with no template → rejected with `TEMPLATE_REQUIRED`.

---

### Step 1.10 — Google Business Profile (Exotel) adapter

**Files:**
- `modules/sales/adapters/gbp/routes.ts` — `POST /api/webhooks/gbp-call`
- `modules/sales/adapters/gbp/service.ts`
- `modules/sales/adapters/gbp/service.test.ts`

Webhook from Exotel on call lifecycle events (`StartTime`, `AnsweredTime`, `EndTime`, `Status`).

Flow:
1. Verify Exotel signature on the raw body (per Exotel docs).
2. If `Status = 'answered'`:
   - If `To` (the called number) is a GBP-tracked number → look up connector.
   - If `From` matches an existing contact → append call activity to their lead/deal.
   - Else → create new lead with `source = GBP`, `direction = inbound`, `entry_method = provider_webhook`. Lead is created in `claimed` state assigned to the agent who answered (resolved from Exotel's `AgentID` or routed-to-number mapping).
3. If `Status = 'missed' | 'no-answer'`:
   - Create lead in bid pool with marker `is_missed_call = true` in `normalized_payload`.
   - SLA: callback within 10 business minutes.
4. Store recording URL (if provided) on the call activity; scope to lead participants only.

**Tests:**
- Answered call from known contact → activity appended, no new lead.
- Missed call from unknown number → new lead, `bid_state = pool_open`.
- Signature invalid → 401 and no DB write.

---

### Step 1.11 — CSV / XLSX import pipeline

**Files:**
- `modules/sales/imports/routes.ts` — `POST /api/lead-imports`, `POST /api/lead-imports/:id/commit`
- `modules/sales/imports/service.ts`
- `modules/sales/imports/parser.ts` — accepts CSV and XLSX
- `modules/sales/imports/dry-run.ts`
- `modules/sales/imports/workers/commit-worker.ts`

File limits: 20 MB, 10 000 rows.

Dry-run output: per-row result (`valid` / `invalid_contact` / `duplicate` / `unknown_source` / `owner_out_of_scope` / `missing_routing_attributes`) plus suggested fixes.

Commit:
- File digest + `row_key` ensure idempotency; replays complete remaining rows only.
- Each valid row → `sales.intake.ingest` with `entry_method = import`.
- Invalid rows are left actionable; manager can download the error CSV.

**Tests:**
- Dry-run with 100 rows, 15 invalid → report shows 85 valid, 15 invalid with reasons; zero DB rows written.
- Commit with duplicate submission → one lead per row key.
- File > 20 MB → `413 Payload Too Large`.

---

### Step 1.12 — Manual entry drawer refactor

**Files:**
- `packages/client/src/company/sales/leads/AddLeadDrawer.tsx` (rewrite)
- `packages/client/src/company/sales/leads/AddLeadDrawer.test.tsx`

UI:
- Compact drawer (slide-in from right): name, phone or email, source dropdown, requirement text. Advanced section (collapsed): company, location, service, campaign, language, contact preference, notes.
- Direction + entry method set from UI context (receptionist mode vs agent mode).
- Live duplicate check as user types phone/email (debounced 400 ms); offers Open existing / Add enquiry / Create separate.
- Idempotency key generated client-side, resent on retry.
- Keyboard shortcut: `A` or `Alt+N` to open from anywhere in Sales.

**Tests:**
- Playwright: open drawer, enter known phone → "possible duplicate" surfaces.
- Submit without next action → warning; cannot skip for assigned active leads.

---

### Step 1.13 — Bid Pool page + card component

**Files:**
- `packages/client/src/company/sales/BidPool/BidPoolPage.tsx`
- `packages/client/src/company/sales/BidPool/BidCard.tsx`
- `packages/client/src/company/sales/BidPool/useBidPool.ts` — WebSocket subscription hook
- `.../BidCard.test.tsx`
- `.../BidPoolPage.test.tsx`

Card content: see PRD §8.3 R-BID-02. Masked contact, viewer count, aging indicator, service, location, budget bracket, truncated message, Accept + Pass buttons.

Interactions:
- Accept → optimistic UI → server call → on success, navigate to `/sales/leads/:id`; on 409 → toast + remove card.
- Pass → modal with reason quick-picks (`wrong_location`, `out_of_expertise`, `at_capacity`, `other`) → server call → card disappears locally for 5 min.
- Real-time: `bid-pool.added` prepends card; `bid-pool.removed` animates out; `bid-pool.viewer-count` updates the badge (debounced render).

**Accessibility:** card is a `<article>` with `aria-labelledby` on its heading; Accept is the default focus target.

**Tests:**
- Simulated 409 on Accept → correct toast, card removed.
- Pass hides card locally; it does not reappear via realtime for 5 min.

---

### Step 1.14 — My Work screen

**Files:**
- `packages/client/src/company/sales/MyWork/MyWorkPage.tsx`
- `.../sections/BidPoolSection.tsx` (embeds `BidPoolPage` content, scoped)
- `.../sections/DueActivitiesSection.tsx`
- `.../sections/HandoverOffersSection.tsx`
- `.../sections/NewlyAssignedSection.tsx`

Priority order (R-UX-02): live offers → overdue commitments → urgent inbound attempts → upcoming actions → suggested follow-ups.

Section headers show counts; each item shows due time, reason, primary action.

**Tests:** Playwright scenario — new bid-pool lead appears instantly in the Bid Pool section without reload.

---

### Step 1.15 — Lead detail refactor + reassign UI

**Files:**
- `packages/client/src/company/sales/leads/LeadDetailPage.tsx` (updated)
- `.../leads/ReassignModal.tsx` — new
- `.../leads/ReassignModal.test.tsx`

Lead detail header shows:
- Full name, phone, email (unmasked for the holder; masked for Supervisor viewers of other-team leads per role scope)
- Chain: `originatingAgent → currentHolder` with timestamps
- SLA timer (first-contact countdown or breach badge)
- Risk flags

Reassign modal:
- Dropdown: eligible agents in the pool. Fetched from availability facade.
- Reason text (required, min 5 chars).
- Transfer options: pending callbacks (default on), scheduled activities (default on), sourcing credit (default off, visible only to Super Admin).
- Submit → calls `POST /api/leads/:id/reassign`.

**Tests:** agent viewing detail does not see the Reassign button; HOD does; sourcing-credit toggle hidden from HOD.

---

### Step 1.16 — Triage queue (manager view)

**Files:**
- `packages/client/src/company/sales/Triage/TriagePage.tsx`
- `.../Triage/TriagePage.test.tsx`

Shows leads with `bid_state = triage`. Columns: age in pool, reason (`no_eligible_agents`, `ambiguous_classification`, `review_queue_from_email`), source, service, location.

Actions:
- Rescue: assign to a specific agent (opens eligible-agents picker + reason).
- Return to pool: forces re-expansion into bid pool if eligibility has changed.
- Close: mark as `rejected` with reason.

Supervisor sees own-pool triage; HOD + Super Admin see all.

**Tests:** rescue action calls `POST /api/leads/:id/reassign` with routing reason `triage_rescue`.

---

### Step 1.17 — Fairness guards + supervisor dashboard

**Files:**
- `modules/sales/bidding/fairness.ts` — server enforcement
- `packages/client/src/company/sales/dashboards/ClaimsDistribution.tsx` — live chart
- `packages/client/src/company/sales/dashboards/PoolHealth.tsx`

Server enforcement (called inside claim transaction):

```ts
export async function checkFairness(tx: Tx, orgId: string, userId: string, poolId: string): Promise<void> {
  const config = await loadFairnessConfig(tx, orgId);
  if (config.dailyClaimMax != null) {
    const claims = await tx.one<{ count: string }>(sql`
      SELECT count(*)::text AS count FROM bid_pool_view
      WHERE organization_id = ${orgId} AND agent_id = ${userId}
        AND action = 'claimed' AND last_seen_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata')
    `);
    if (Number(claims.count) >= config.dailyClaimMax) throw new DailyCapReachedError();
  }
  const active = await tx.one<{ count: string }>(sql`
    SELECT count(*)::text AS count FROM lead
    WHERE organization_id = ${orgId} AND owner_id = ${userId} AND lead_outcome = 'active'
  `);
  if (Number(active.count) >= config.activeLeadMax) throw new ActiveCapReachedError();
}
```

Dashboard shows per-agent claim count today (sorted DESC) and 24h bid-pool health (open / claimed / fallback / triage counts).

**Tests:**
- Agent at active-lead cap attempts claim → 409 `ACTIVE_CAP_REACHED`.
- Agent passes a lead; same lead re-expands into their pool 3 min later → still hidden.

---

### Step 1.18 — Activities enhancements

**Files:**
- `modules/sales/leads/callback-service.ts` (patch — callback owner fix)
- `modules/sales/leads/callback-service.test.ts` (updated)
- `modules/sales/leads/activity-types.ts` (new — adds `whatsapp`, `demo`, `proposal_follow_up`)

Fix per PRD §12 R-HAND-04 and §2.3 conflict resolution: callback assignee resolves to `originating_agent_id` (the active relationship owner), not `current_holder_id`. Current logic prefers `currentHolderId` — that is wrong post-handover.

```diff
- const assignee = lead.currentHolderId ?? lead.ownerId;
+ const assignee = lead.originatingAgentId ?? lead.ownerId;
```

Add new activity types and ensure the activity type union is centralised.

**Tests:**
- After handover to supervisor, scheduling a callback assigns it back to the originating agent.
- Existing tests continue to pass.

---

## Cross-cutting concerns

### Observability

Add Pino log context for every intake event: `connectorId`, `submissionId`, `externalLeadId`, `leadId`, `outcome`. Metrics:

- `sales.intake.received_total{connector_kind, outcome}` (counter)
- `sales.intake.pipeline_duration_seconds` (histogram)
- `sales.bid_pool.open_count` (gauge, by pool)
- `sales.bid_pool.claim_latency_ms` (histogram, from pool open → claim)
- `sales.bid_pool.fallback_total{reason}` (counter)
- `sales.bid_pool.pass_total{reason}` (counter)

### Authorization audit

Every bid-pool claim, pass, triage rescue, reassign, intake pause/resume → audit event via existing `platform/audit`. Include `before` and `after` snapshots for state transitions.

### Secret handling

Per-connector tokens, HMAC secrets and WhatsApp credentials go into the existing secret store with rotation support. Never log secrets. Every retrieval is attributed in audit.

### Error contracts

Standardise error codes used by the new APIs:

| Code | HTTP | When |
|---|---|---|
| `ALREADY_CLAIMED` | 409 | Bid-pool claim lost the race |
| `NOT_ELIGIBLE` | 403 | Caller fails availability check |
| `ACTIVE_CAP_REACHED` | 409 | Agent at active-lead cap |
| `DAILY_CAP_REACHED` | 409 | Agent at daily claim cap |
| `AUTH_SELF_ASSIGN` | 403 | Super Admin assigning target to self (R4; placeholder for R1 consistency) |
| `AUTH_EXTEND_NOT_ALLOWED` | 403 | HOD trying to extend target (R4; placeholder) |
| `AMBIGUOUS_PHONE` | 422 | Phone number lacks country context |
| `UNKNOWN_CONNECTOR` | 404 | Webhook received for inactive/unknown connector |
| `SIGNATURE_INVALID` | 401 | Webhook signature verification failed |
| `TEMPLATE_REQUIRED` | 422 | WhatsApp outbound outside 24h window without template |

### Testing strategy

| Layer | Tool | Coverage expectation |
|---|---|---|
| Unit (service, policy, mappers) | Vitest | 90%+ on bidding + intake |
| Repository (integration against Postgres) | Vitest with testcontainers | All critical paths |
| HTTP routes | Supertest | Happy paths + auth denials + 409s |
| Realtime | Socket.IO test client | Pub/sub between sockets |
| Workers | Vitest + fake BullMQ | Idempotency, backoff respect |
| Client UI | Vitest + Testing Library | Component logic |
| E2E | Playwright | Golden flow: Meta lead arrives → bid pool → claim → first call attempt |

Required e2e scenarios before R1 pilot:
1. Meta webhook → bid pool → agent A claims → appears in Lead Detail with SLA clock.
2. Website webhook → two agents race → one wins, one sees 409 toast.
3. Bid-pool timeout → auto-router picks fallback agent.
4. Email from known contact → appends to timeline, no new lead.
5. GBP missed call → bid pool → return callback within SLA.
6. HOD reassigns a claimed lead → previous holder notified; sourcing credit preserved.

### Migration safety

- All 0075–0077 migrations are **additive only** on existing tables; no column drops.
- Backfills run in batches of 1000 rows with progress logs.
- Feature flags (via existing `platform/feature-flags`):
  - `sales.bidding.enabled` — gates bid-pool code paths
  - `sales.adapters.meta.enabled`
  - `sales.adapters.email.enabled`
  - `sales.adapters.whatsapp.enabled`
  - `sales.adapters.gbp.enabled`
  - `sales.imports.enabled`
- Rollback: feature flag off → legacy routing path (fewest-open-leads) handles all leads; new columns remain on the table unused.

### Documentation

- Each adapter folder gets a `README.md` summarising provider setup, token scopes, webhook URLs, test leads.
- Operations runbook: `docs/runbooks/sales-intake.md` with reconnect, replay, quarantine review, dead-letter inspection, bid-pool fairness audit.
- `docs/architecture/sales-v1.1.md` with the diagrams from PRD §6.2 and §8.1.

---

## Acceptance tests mapped to PRD §23

| PRD AT | Covered by |
|---|---|
| AT01–AT02 (manual entry) | Step 1.12 tests |
| AT03 (website retry) | Step 1.6 tests |
| AT04 (Meta notification retry) | Step 1.7 tests |
| AT07 (storage fails pre-ACK) | Step 1.1 ingest-worker test |
| AT08 (token revoked) | Step 1.7 reconcile tests |
| AT09 (worker restart) | Step 0.8 worker tests |
| AT10–AT11 (dup handling) | Step 1.2 tests |
| AT12–AT13 (import) | Step 1.11 tests |
| AT14′ (concurrent claim) | Step 1.3 tests |
| AT15 (nobody on shift) | Step 1.1 + 1.4 tests |
| AT16 (direct API reassign by agent) | Step 1.5 tests |
| AT17–AT18 (handover queue) | Step 1.18 tests |
| AT20–AT22 (reminders / no-answer / push) | Step 1.18 tests |
| AT39 (UTC vs local date) | Step 0.6 tests |
| AT40 (cross-tenant) | Platform-level — existing coverage |
| AT43–AT47 (bidding) | Step 1.3 + 1.5 tests |
| AT57–AT60 (email + WhatsApp + GBP) | Steps 1.8, 1.9, 1.10 tests |
| AT61 (dual-clock) | Step 0.6 + Step 1.9 tests |
| AT63 (tenant isolation) | Platform-level |

Deferred to later phases: AT19 (deal creation), AT23–AT38 (deals + commercials + payments), AT41–AT42 (migration edge cases that depend on deal data), AT48–AT56 (targets), AT62 (team roll-ups).

---

## Open questions blocking R1

1. **O1 WhatsApp provider decision** — blocks Step 1.9's primary driver choice (we build all four interfaces regardless, but production can't ship without the chosen provider's credentials).
2. **O2 Exotel vs alternative GBP call-tracking** — blocks Step 1.10 webhook signature validation shape.
3. **O3 Fairness caps default values** — blocks Step 1.17 tests (needs confirmed thresholds).
4. **O4 Initial Super Admin + HOD seats** — needed to seed authorization fixtures.
5. **Email mailbox provider (Google Workspace vs Microsoft 365)** — determines which driver (Step 1.8) is built first.

None of these block R0. Begin R0 immediately; collect O1–O5 answers in parallel.

---

## Pilot definition

End of R1 is the **Pilot Milestone**. Pilot means:

- One tenant live
- Two of the five source adapters active (recommend Website + Meta Lead Ads first)
- One pool of 3–5 agents using bidding end-to-end
- Fallback router working on timeout
- Email + WhatsApp adapters implemented but disabled behind flags
- GBP adapter implemented but call tracking not yet enabled
- Manual entry + imports fully usable
- Daily acceptance report (SQL dashboard) reconciling intake events ↔ leads created ↔ claims ↔ SLA breaches

Pilot exit criteria to move to R2:
- 7-day streak of zero lost acknowledged submissions
- Bid-pool pickup rate ≥ 85 percent (within 10-minute SLA)
- No critical access-control defects open
- UAT sign-off from Sales HOD and one Sales Agent

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Meta Page token expires mid-pilot | Reconnect flow + alerts on `reconnect_required`; manual retrieval via Business Manager documented in runbook |
| Exotel webhook format differs from docs in practice | Capture one real call payload in sandbox before writing parser; parameterise provider in config |
| WhatsApp provider templates not approved on time | Pilot with manual outbound (links to WhatsApp app) first; bidding + inbound intake unaffected |
| Fairness perception issues from agents | Make claims-distribution dashboard visible from day 1; share weekly stats proactively |
| Receptionist accidentally becomes owner | Enforced in Step 1.1 (R-MAN-03 lives in intake); route all inbound to normal routing by default |
| Migration 0075 duplicates contacts | Pre-run cleanup script finds likely duplicates and surfaces them to the admin for manual merge before migration |
| Bid-pool WebSocket flakes under load | Fall back to 15-second poll if WS disconnects; display stale indicator |
| Pre-claim PII leak via inspector / API | Server-side masking (not client-side); API returns masked payload until claim is successful |

---

End of plan.
