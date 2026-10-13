# Sales Management v1.1 — R2 Implementation Plan

**Spec:** `2026-10-05-sales-management-prd-v1.1.md`
**Date:** 2026-10-06
**Covers:** Increment R2 (Deals, Proposals, Approvals, Contracts, Payments, Delivery handoff)
**Depends on:** R0 + R1 shipped — contact/company entities, canonical intake, bidding, routing, reassignment, triage, fairness, supervisor dashboard.
**Out of scope here:** R3 recurring/renewals, R4 Targets + Receipts dashboards, R5 Reporting.

---

## Overview

R2 turns a claimed lead into a closed sale: a Deal with commercials, an approved proposal, a signed contract, verified receipts, and a delivery brief that creates exactly one project.

The money path is the hard constraint — every amount is calculated server-side in integer minor units (paise), every receipt is verified before it counts, every allocation is unique. The public proposal portal is the only unauthenticated surface and gets its own threat model.

Pilot can go live after Step 2.15 (**Won recorder**) if your proposal / approval / contract workflow is manual-document-driven; steps 2.10–2.14 land in parallel for the full digital path.

### R2 steps (estimated 10–14 engineering weeks)

| #    | Step                                                | Primary artefacts |
|------|-----------------------------------------------------|---|
| 2.1  | Deal entity + state fields                          | migration 0079 |
| 2.2  | Commercials + proposal versioning schema            | migration 0080 |
| 2.3  | Approval request + decision schema                  | migration 0081 |
| 2.4  | Contract + signature evidence schema                | migration 0082 |
| 2.5  | Receipts, allocations, payment-webhook schema       | migration 0083 |
| 2.6  | Delivery brief + project link schema                | migration 0084 |
| 2.7  | Deals service — CRUD, state transitions, probability | `modules/sales/deals/*` |
| 2.8  | Commercials service — pricing math in minor units    | `modules/sales/commercials/*` |
| 2.9  | Proposals service — draft/publish/versioning         | `modules/sales/proposals/*` |
| 2.10 | Public proposal portal + acceptance evidence         | `modules/sales/proposals/portal/*` |
| 2.11 | Approvals service — routing, SLA, delegate rules     | `modules/sales/approvals/*` |
| 2.12 | Contracts service                                    | `modules/sales/contracts/*` |
| 2.13 | Payments: receipts + allocation + Razorpay webhook   | `modules/sales/payments/*` |
| 2.14 | Won recorder — readiness check + close command       | `modules/sales/deals/won.ts` |
| 2.15 | Delivery brief service + project link                | `modules/sales/delivery/*` |
| 2.16 | Client: Deals list + detail                          | `client/.../deals/*` |
| 2.17 | Client: Commercials editor + proposals studio        | `client/.../proposals/*` |
| 2.18 | Client: Approvals queue                              | `client/.../approvals/*` |
| 2.19 | Client: Payments + receipts + reconciliation         | `client/.../payments/*` |
| 2.20 | Client: Wins-to-record queue                         | `client/.../wins/*` |
| 2.21 | Client: Delivery brief + handoff                     | `client/.../delivery/*` |

Each step has (a) migration if applicable, (b) server module, (c) client module, (d) tests, (e) acceptance criteria.

---

## Phase R2A — Schema (migrations 0079–0084)

All six migrations are additive-only on existing tables; one new table per concern. All six are safe to run on a running cluster; FK targets point to existing rows.

### Step 2.1 — Migration: Deal

**File:** `migrations/0079_sales_deals.sql`

```sql
CREATE TABLE deal (
  id                       uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id          uuid NOT NULL REFERENCES organization(id),
  deal_number              bigint GENERATED ALWAYS AS IDENTITY,
  originating_lead_id      uuid REFERENCES lead(id),
  direct_entry_reason      text,
  contact_id               uuid NOT NULL REFERENCES contact(id),
  company_id               uuid REFERENCES company(id),
  service_requested        text,
  title                    text NOT NULL,
  scope_summary            text,

  -- Attribution — mirrors the lead's lineage (R-DEAL-02).
  originating_agent_id     uuid NOT NULL REFERENCES app_user(id),
  responsible_closer_id    uuid NOT NULL REFERENCES app_user(id),
  closed_by_id             uuid REFERENCES app_user(id),

  currency                 text NOT NULL DEFAULT 'INR',
  expected_close_at        timestamptz,
  probability_override     numeric(5,2),             -- overrides stage default when non-null

  commercials_version      uuid,                      -- active proposal version; set once step 2.2 lands

  -- Five independent state dimensions (R-DEAL-02).
  deal_stage               text NOT NULL DEFAULT 'discovery'
                             CHECK (deal_stage IN ('discovery','proposal','negotiation','closing','closed')),
  approval_status          text NOT NULL DEFAULT 'not_required'
                             CHECK (approval_status IN ('not_required','pending','approved','rejected')),
  contract_status          text NOT NULL DEFAULT 'not_required'
                             CHECK (contract_status IN ('not_required','draft','sent','signed','voided')),
  payment_status           text NOT NULL DEFAULT 'unpaid'
                             CHECK (payment_status IN ('unpaid','partial','advance_confirmed','paid','partially_refunded','refunded')),
  lifecycle_status         text NOT NULL DEFAULT 'open'
                             CHECK (lifecycle_status IN ('open','won','lost','cancelled')),

  loss_reason              text,
  lost_at                  timestamptz,
  won_at                   timestamptz,
  cancelled_at             timestamptz,

  created_by               uuid NOT NULL REFERENCES app_user(id),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, deal_number),
  CHECK (originating_lead_id IS NOT NULL OR direct_entry_reason IS NOT NULL)
);
CREATE INDEX ON deal (organization_id, lifecycle_status, deal_stage);
CREATE INDEX ON deal (organization_id, responsible_closer_id);
CREATE INDEX ON deal (organization_id, expected_close_at);
SELECT apply_tenant_rls('deal');

CREATE TABLE deal_contact (
  deal_id         uuid NOT NULL REFERENCES deal(id) ON DELETE CASCADE,
  contact_id      uuid NOT NULL REFERENCES contact(id),
  role            text NOT NULL CHECK (role IN ('primary_buyer','influencer','signatory','billing')),
  PRIMARY KEY (deal_id, contact_id, role)
);
SELECT apply_tenant_rls('deal_contact');
```

**Server surface:** none yet — tables are consumed in Step 2.7.

**Tests:** migration dry-run on a clone; CHECK constraints reject invalid state values.

**Acceptance:** every row has a 5-tuple of state fields, the deal_number counter starts at 1, and every deal has either an originating lead or a direct-entry reason.

---

### Step 2.2 — Migration: Commercials + Proposal versioning

**File:** `migrations/0080_sales_commercials.sql`

```sql
CREATE TABLE commercials (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id    uuid NOT NULL,
  deal_id            uuid NOT NULL REFERENCES deal(id) ON DELETE CASCADE,
  version            integer NOT NULL,                       -- monotonic per deal
  state              text NOT NULL DEFAULT 'draft'
                       CHECK (state IN ('draft','published','superseded','expired','accepted','rejected')),
  currency           text NOT NULL,
  subtotal_minor     bigint NOT NULL,                        -- integer paise
  discount_minor     bigint NOT NULL,
  tax_minor          bigint NOT NULL,
  total_minor        bigint NOT NULL,
  advance_minor      bigint NOT NULL,                        -- expected advance
  validity_at        timestamptz,
  scope              text,
  exclusions         text,
  timeline           text,
  terms              text,
  pdf_checksum       text,                                   -- set at publish; verified at acceptance
  published_at       timestamptz,
  published_by       uuid REFERENCES app_user(id),
  accepted_at        timestamptz,
  accepted_evidence  jsonb,                                  -- {ip, userAgent, token hash}
  created_by         uuid NOT NULL REFERENCES app_user(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deal_id, version),
  CHECK (total_minor = subtotal_minor - discount_minor + tax_minor)
);
CREATE INDEX ON commercials (organization_id, deal_id, state);
SELECT apply_tenant_rls('commercials');

CREATE TABLE commercials_item (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id    uuid NOT NULL,
  commercials_id     uuid NOT NULL REFERENCES commercials(id) ON DELETE CASCADE,
  service_name       text NOT NULL,
  description        text,
  quantity           numeric(14,4) NOT NULL,                 -- fractional for hours
  unit_price_minor   bigint NOT NULL,
  discount_minor     bigint NOT NULL DEFAULT 0,
  tax_category       text NOT NULL DEFAULT 'standard',
  tax_rate_bps       integer NOT NULL DEFAULT 0,             -- basis points, e.g. 1800 = 18%
  line_total_minor   bigint NOT NULL,
  milestone          text,
  sort_order         integer NOT NULL DEFAULT 0
);
CREATE INDEX ON commercials_item (organization_id, commercials_id, sort_order);
SELECT apply_tenant_rls('commercials_item');

-- Public token (R-PORTAL-01): per-published-version revocable token.
CREATE TABLE proposal_portal_token (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id    uuid NOT NULL,
  commercials_id     uuid NOT NULL REFERENCES commercials(id) ON DELETE CASCADE,
  token_hash         text NOT NULL UNIQUE,                   -- SHA-256 of the raw token
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz,
  recipient_verified boolean NOT NULL DEFAULT false,
  created_by         uuid NOT NULL REFERENCES app_user(id),
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON proposal_portal_token (organization_id, commercials_id);
SELECT apply_tenant_rls('proposal_portal_token');
```

**Acceptance:** `total_minor` is always `subtotal - discount + tax` (CHECK); versioning is monotonic per deal; token hash is unique globally so no two active public links collide.

---

### Step 2.3 — Migration: Approvals

**File:** `migrations/0081_sales_approvals.sql`

```sql
CREATE TABLE approval_request (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id     uuid NOT NULL,
  deal_id             uuid NOT NULL REFERENCES deal(id) ON DELETE CASCADE,
  commercials_id      uuid NOT NULL REFERENCES commercials(id) ON DELETE CASCADE,
  dimensions          jsonb NOT NULL,                        -- {value: 'exceeds', discount: 'exceeds', ...}
  requested_by        uuid NOT NULL REFERENCES app_user(id),
  requested_at        timestamptz NOT NULL DEFAULT now(),
  current_approver_id uuid REFERENCES app_user(id),
  sla_due_at          timestamptz NOT NULL,                  -- +4 business hours
  state               text NOT NULL DEFAULT 'pending'
                        CHECK (state IN ('pending','approved','rejected','returned','escalated','cancelled','invalidated'))
);
CREATE INDEX ON approval_request (organization_id, state, sla_due_at);
CREATE INDEX ON approval_request (organization_id, deal_id);
SELECT apply_tenant_rls('approval_request');

CREATE TABLE approval_decision (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id     uuid NOT NULL,
  request_id          uuid NOT NULL REFERENCES approval_request(id) ON DELETE CASCADE,
  actor_id            uuid NOT NULL REFERENCES app_user(id),
  verdict             text NOT NULL CHECK (verdict IN ('approve','reject','return')),
  comment             text,
  decided_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON approval_decision (organization_id, request_id);
SELECT apply_tenant_rls('approval_decision');
```

**Acceptance:** at most one `state='pending'` row per deal (enforced in service, not DB); `sla_due_at` is always a business-hour offset from `requested_at`.

---

### Step 2.4 — Migration: Contracts

**File:** `migrations/0082_sales_contracts.sql`

```sql
CREATE TABLE contract (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id    uuid NOT NULL,
  deal_id            uuid NOT NULL REFERENCES deal(id) ON DELETE CASCADE,
  commercials_id     uuid NOT NULL REFERENCES commercials(id),
  state              text NOT NULL DEFAULT 'draft'
                       CHECK (state IN ('draft','sent','signed','voided','amended','replaced')),
  draft_file_id      uuid,                                  -- platform/files reference
  signed_file_id     uuid,
  checksum           text,
  signer_name        text,
  signer_email       text,
  signer_evidence    jsonb,                                 -- IP, UA, signature method
  sent_at            timestamptz,
  signed_at          timestamptz,
  voided_at          timestamptz,
  supersedes_id      uuid REFERENCES contract(id),
  created_by         uuid NOT NULL REFERENCES app_user(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON contract (organization_id, deal_id, state);
SELECT apply_tenant_rls('contract');
```

**Acceptance:** every signed contract references the commercials version it approves.

---

### Step 2.5 — Migration: Payments

**File:** `migrations/0083_sales_payments.sql`

```sql
CREATE TABLE payment_receipt (
  id                     uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id        uuid NOT NULL,
  provider               text NOT NULL CHECK (provider IN ('razorpay','bank_transfer','cash','cheque','manual')),
  provider_event_id      text,                              -- Razorpay payment_id / webhook event id
  bank_reference         text,                              -- UTR / NEFT / RTGS
  payer_label            text,
  amount_minor           bigint NOT NULL,
  currency               text NOT NULL,
  received_at            timestamptz NOT NULL,
  verified_by            uuid REFERENCES app_user(id),
  verified_at            timestamptz,
  state                  text NOT NULL DEFAULT 'reported'
                           CHECK (state IN ('reported','verified','reconciled','voided','refunded','partially_refunded')),
  idempotency_key        text,
  conversion_rate_bps    integer,                           -- when currency != org default
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, provider, provider_event_id),
  UNIQUE (organization_id, provider, bank_reference)
);
SELECT apply_tenant_rls('payment_receipt');

CREATE TABLE payment_allocation (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id    uuid NOT NULL,
  receipt_id         uuid NOT NULL REFERENCES payment_receipt(id) ON DELETE CASCADE,
  deal_id            uuid NOT NULL REFERENCES deal(id),
  amount_minor       bigint NOT NULL CHECK (amount_minor > 0),
  allocated_by       uuid NOT NULL REFERENCES app_user(id),
  allocated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON payment_allocation (organization_id, deal_id);
CREATE UNIQUE INDEX uniq_allocation_per_receipt_deal
  ON payment_allocation (organization_id, receipt_id, deal_id);
SELECT apply_tenant_rls('payment_allocation');

-- Razorpay webhook journal (R-PAY-02 dedup on provider event ID).
CREATE TABLE payment_webhook_event (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id    uuid NOT NULL,
  provider           text NOT NULL,
  event_id           text NOT NULL,
  raw_payload        bytea NOT NULL,
  signature_valid    boolean NOT NULL,
  processed_at       timestamptz,
  outcome            text NOT NULL DEFAULT 'pending'
                       CHECK (outcome IN ('pending','applied','duplicate','invalid_signature','rejected')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, event_id)
);
SELECT apply_tenant_rls('payment_webhook_event');

-- Refund / chargeback journal.
CREATE TABLE payment_reversal (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id    uuid NOT NULL,
  receipt_id         uuid NOT NULL REFERENCES payment_receipt(id) ON DELETE CASCADE,
  amount_minor       bigint NOT NULL CHECK (amount_minor > 0),
  reason             text NOT NULL,
  recorded_by        uuid NOT NULL REFERENCES app_user(id),
  recorded_at        timestamptz NOT NULL DEFAULT now()
);
SELECT apply_tenant_rls('payment_reversal');
```

**Acceptance:** two concurrent allocations of the same amount against the same receipt→deal pair fail the unique index; verified receipts are the only state that qualifies for allocation.

---

### Step 2.6 — Migration: Delivery brief

**File:** `migrations/0084_sales_delivery.sql`

```sql
CREATE TABLE delivery_brief (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id    uuid NOT NULL,
  deal_id            uuid NOT NULL REFERENCES deal(id),
  commercials_id     uuid NOT NULL REFERENCES commercials(id),
  state              text NOT NULL DEFAULT 'draft'
                       CHECK (state IN ('draft','submitted','changes_requested','accepted','cancelled')),
  content            jsonb NOT NULL DEFAULT '{}'::jsonb,
  project_id         uuid REFERENCES project(id),           -- set on acceptance
  submitted_at       timestamptz,
  accepted_at        timestamptz,
  accepted_by        uuid REFERENCES app_user(id),
  cancelled_at      timestamptz,
  cancelled_reason   text,
  created_by         uuid NOT NULL REFERENCES app_user(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, deal_id)
);
SELECT apply_tenant_rls('delivery_brief');
```

**Acceptance:** one brief per deal; `project_id` is set exactly once, on acceptance, via an idempotent service event.

---

## Phase R2B — Server services (steps 2.7–2.15)

### Step 2.7 — Deals service

**Files:**
- `modules/sales/deals/service.ts`
- `modules/sales/deals/state-machine.ts`
- `modules/sales/deals/probability.ts`
- `modules/sales/deals/policy.ts`
- `modules/sales/deals/routes.ts`
- `modules/sales/deals/service.test.ts`

**Public API:**
```ts
export async function createDeal(ctx, input: { leadId?: string; title: string; serviceRequested?: string; ... }): Promise<Deal>;
export async function listDeals(ctx, query: DealListQuery): Promise<DealPage>;
export async function getDeal(ctx, id: string): Promise<Deal>;
export async function updateDealStage(ctx, id: string, next: DealStage): Promise<Deal>;
export async function overrideProbability(ctx, id: string, probability: number, reason: string): Promise<Deal>;
export async function markLost(ctx, id: string, reason: StructuredLossReason): Promise<Deal>;
export async function cancelAfterWin(ctx, id: string, reason: string): Promise<Deal>;
```

**Policy:** 5 new actions in registry — `deals:create`, `deals:edit`, `deals:view`, `deals:forecast`, `deals:allow-custom-terms`. Resource type `deal` with scope-by-closer / scope-by-team.

**State machine (R-DEAL-03):**
- Legal `dealStage` transitions: discovery → proposal → negotiation → closing → closed; backwards transitions permitted on authority.
- `lifecycleStatus` transitions: open → won/lost/cancelled are mutually exclusive and terminal.

**Default probabilities (R-DEAL-06):** 20/40/60/85 per stage; override requires `deals:forecast` plus a reason captured in audit.

**Tests:**
- Create from a claimed lead copies the lead's `originating_agent_id` into the deal.
- Updating `dealStage` to `closed` via public API is rejected — only the Win Recorder (Step 2.14) sets `closed`.
- Overriding probability without `deals:forecast` returns 403.
- Marking a deal `lost` requires a structured reason enum value.

**Acceptance:** every deal has `originating_agent_id` set; the win-recorder is the only writer of `(dealStage='closed', lifecycleStatus='won')`.

---

### Step 2.8 — Commercials service

**Files:**
- `modules/sales/commercials/service.ts`
- `modules/sales/commercials/math.ts`
- `modules/sales/commercials/math.test.ts`
- `modules/sales/commercials/validators.ts`

**All money in `bigint` minor units.** `math.ts` exports pure helpers:
```ts
export function lineTotalMinor({ quantity, unitPriceMinor, discountMinor, taxRateBps }): bigint;
export function sumSubtotalMinor(items: readonly Item[]): bigint;
export function applyDocumentDiscount(subtotal: bigint, discount: Discount): bigint;
export function documentTaxMinor(subtotal: bigint, items: readonly Item[]): bigint;
```

**Order of operations (R-PROP-02):**
1. Each item: `(quantity * unitPrice) - itemDiscount`, round half-even to minor units.
2. Sum item line totals → `subtotal`.
3. Apply document-level discount to `subtotal` → `discounted_subtotal`.
4. For each tax category, compute tax from the discounted line-totals in that category → sum to `tax`.
5. `total = discounted_subtotal + tax`.

**Validators:** zod schemas for item + commercials body; totals rejected if client-sent values disagree with recomputed server-side values.

**Tests:**
- Golden table: 20 cases from the finance spec (unit prices with fractions, basis-point taxes, mixed item + document discounts). Each case asserts exact minor-unit totals.
- Floating-point drift: `0.1 + 0.2` cases produce zero drift (we never use `number` for prices).
- Rounding half-even: 2.5 rounds to 2, 3.5 rounds to 4.

**Acceptance:** no money arithmetic uses `number` or `float`; `commercials.total_minor = subtotal - discount + tax` CHECK is never violated.

---

### Step 2.9 — Proposals service

**Files:**
- `modules/sales/proposals/service.ts`
- `modules/sales/proposals/versioning.ts`
- `modules/sales/proposals/service.test.ts`

**Public API:**
```ts
export async function createDraft(ctx, dealId, input): Promise<Commercials>;
export async function updateDraft(ctx, commercialsId, input): Promise<Commercials>;    // optimistic version check
export async function publishVersion(ctx, commercialsId): Promise<Commercials>;        // freezes, computes checksum
export async function supersede(ctx, commercialsId): Promise<Commercials>;             // when creating a new version
```

**Pre-publish checks (R-PROP-05):**
- Caller holds `deals:edit` on the deal.
- Recipient contact exists on `deal_contact` with `role='primary_buyer'` or `signatory`.
- Contact permission (consent) recorded.
- Validity-at ≥ now.
- Required fields present.
- Approval status is `approved` OR dimensions don't need approval.

**Autosave + optimistic lock:** `commercials.updated_at` is sent back as `If-Match`; concurrent edits yield 409 with the server copy.

**Publish freezes:** scope, prices, terms, PDF checksum. Editing a published version creates a new version (next integer) that `supersedes` the previous.

**Tests:**
- Publishing without an approved approval request when dimensions require one is rejected with the unmet-condition name.
- Two concurrent `updateDraft` calls: one succeeds, one gets 409 with the server copy.
- Publishing produces a new PDF checksum derived from the frozen data; identical publish of the same version is a no-op.

---

### Step 2.10 — Public proposal portal

**Files:**
- `modules/sales/proposals/portal/public-routes.ts`
- `modules/sales/proposals/portal/token.ts`
- `modules/sales/proposals/portal/service.ts`
- `modules/sales/proposals/portal/service.test.ts`

**Routes (unauthenticated, mounted before `express.json`):**
```
GET  /api/public/proposals/:token           → masked proposal body
POST /api/public/proposals/:token/accept    → records acceptance, captures evidence
POST /api/public/proposals/:token/question  → records a comment, no state change
```

**Token (R-PORTAL-01):**
- Generated at publish OR on explicit "share link" action.
- 32 random bytes, base64url encoded (≈43 chars); only the SHA-256 hash is stored.
- Expiry: `commercials.validity_at` or 30 days, whichever is sooner.
- Rate limit per token: 30 rpm, with a 10-attempt per IP cap.
- `X-Robots-Tag: noindex, nofollow, noarchive`, `Referrer-Policy: no-referrer`.

**Acceptance evidence captured:**
- IP (via `X-Forwarded-For` from trusted edge), User-Agent, timestamp.
- SHA-256 of the token (match proof).
- Commercials PDF checksum at acceptance time (must match the current version).

**Expired / revoked / superseded (R-PORTAL-03):** 410 Gone with a message; no body served.

**Tests:**
- Expired token → 410, no acceptance record.
- Replay of the same acceptance payload → single `commercials.accepted_at`, same evidence row.
- Rate-limit breach → 429, no DB write.
- Supersede after share: public link to the old version becomes 410 on next hit.

**Threat model:** no sequential IDs leaked, no deal/contact names in URLs, every log line redacts token.

---

### Step 2.11 — Approvals service

**Files:**
- `modules/sales/approvals/service.ts`
- `modules/sales/approvals/routing.ts`
- `modules/sales/approvals/sla.ts`
- `modules/sales/approvals/service.test.ts`

**Public API:**
```ts
export async function requestApproval(ctx, commercialsId): Promise<ApprovalRequest>;
export async function decide(ctx, requestId, { verdict, comment }): Promise<ApprovalRequest>;
export async function listPending(ctx): Promise<ApprovalRequest[]>;
```

**Dimensions evaluated (R-APP-01):**
- Total value vs actor authority
- Document + per-item discount percentage vs limit
- Margin where cost data available
- Non-standard terms (payment schedule, cancellation, non-refundable advance etc.)
- Advance less than policy
- Custom contract requirements

**Routing (R-APP-03):** lowest eligible independent authority holding every exceeded dimension. No eligible approver → "visibly blocked" state, no silent drops.

**SLA (R-APP-05):** 4 business hours from `requested_at`; after breach, the escalation worker reassigns to next eligible authority. Audited.

**Delegate rules (R-APP-06):** delegates must hold equivalent authority. Requester cannot be delegate. No onward delegation.

**Invalidation:** any change to the commercials' value, items, scope, discount, advance, or controlled terms flips the pending request to `invalidated` and a new one is required.

**Tests:**
- No eligible approver → request state `pending` + a `blocked_reason` metadata; UI must surface.
- 4-hour SLA breach → request escalated once; a second breach does not escalate again (prevents loops).
- Requester as delegate → 403.
- Material commercials change invalidates the pending request + audits before/after.

---

### Step 2.12 — Contracts service

**Files:**
- `modules/sales/contracts/service.ts`
- `modules/sales/contracts/service.test.ts`

**Public API:**
```ts
export async function createDraft(ctx, dealId, { commercialsId, draftFileId }): Promise<Contract>;
export async function markSent(ctx, contractId, { signerName, signerEmail }): Promise<Contract>;
export async function recordSignature(ctx, contractId, { signedFileId, signerEvidence }): Promise<Contract>;
export async function void(ctx, contractId, { reason }): Promise<Contract>;
export async function amend(ctx, oldContractId, { newDraftFileId }): Promise<Contract>;   // supersedes
```

**Policy:** sign recording requires `deals:approve-contract`. The signer-evidence shape mirrors the proposal portal's (IP, UA, time) with the file's SHA-256 pinned.

**Tests:**
- Amendment after sign creates a new contract row pointing at the superseded one; the superseded row stays signed; the deal's active contract is the new row.
- Material change to the commercials after sign requires an amendment (Won recorder enforces).

---

### Step 2.13 — Payments

**Files:**
- `modules/sales/payments/service.ts`
- `modules/sales/payments/razorpay-webhook.ts`
- `modules/sales/payments/allocation.ts`
- `modules/sales/payments/service.test.ts`

**Public API:**
```ts
export async function reportReceipt(ctx, input): Promise<PaymentReceipt>;        // manual entry by agent
export async function verifyReceipt(ctx, receiptId): Promise<PaymentReceipt>;    // Finance / deals:confirm-payment
export async function allocate(ctx, receiptId, dealId, amountMinor): Promise<PaymentAllocation>;
export async function recordReversal(ctx, receiptId, { amountMinor, reason }): Promise<void>;
```

**Razorpay webhook `POST /api/public/webhooks/razorpay`:**
- Verify signature header `X-Razorpay-Signature` as HMAC-SHA256 of raw body with the webhook secret.
- Durably journal to `payment_webhook_event` before processing.
- Dedup on `(provider, event_id)` unique index.
- Only process `payment.captured`; everything else is logged + marked `rejected` with reason.
- Idempotent: re-processing the same event is a no-op.

**Allocation rules (R-PAY-04):**
- A receipt may be split across multiple deals; the sum of allocations must equal the receipt's amount.
- Cross-currency receipt needs a `conversion_rate_bps` + approver (new approval action `payments:approve-fx`, deferred).

**Verification (R-PAY-01):**
- `reported` → `verified` requires `deals:confirm-payment`.
- Only verified receipts can be allocated.

**Reversals (R-PAY-06):**
- Receipt → `partially_refunded` or `refunded`.
- Each deal's `payment_status` recomputed from net allocations.

**Tests:**
- Razorpay webhook replay (same `event_id`) → `payment_webhook_event.outcome='duplicate'`, no new receipt.
- Bank transfer with a UTR that was already stored → unique-index violation, surfaced as `409 PAYMENT_DUPLICATE`.
- Allocating 500 to deal A and 500 to deal B against a receipt of 1000 — both succeed; a third allocation on the same `(receipt, deal_A)` fails the index.
- Reversal of 400 on a 1000 receipt with 500 + 500 split: at-least-once posts `partially_refunded` and leaves allocations intact; net qualifying = 600.

---

### Step 2.14 — Won recorder

**Files:**
- `modules/sales/deals/won.ts`
- `modules/sales/deals/won.test.ts`
- `modules/sales/deals/won-readiness.ts`

**Public API:**
```ts
export interface ReadinessReport {
  canClose: boolean;
  unmet: readonly { condition: string; description: string; resolver: string }[];
}
export async function readinessForClose(ctx, dealId): Promise<ReadinessReport>;
export async function recordWin(ctx, dealId): Promise<Deal>;
```

**Readiness (R-DEAL-03 / R-WIN-01):**
- `approval_status = 'approved'` OR dimensions did not require approval.
- Active contract state ∈ `{'signed', 'not_required'}`.
- Net verified allocation ≥ configured advance for the active commercials.
- Agreed scope ready — the delivery brief is at least `draft` with the required fields.
- Actor holds the configured Sales win-recorder authority (`deals:record-win`, Sales HOD by default).

**Close command (atomic):**
1. Lock the deal row.
2. Re-run readiness inside the lock.
3. Flip `dealStage='closed'`, `lifecycleStatus='won'`, set `won_at`, `closed_by_id`.
4. Idempotent event `sales.deal.won` triggers:
   - Target achievement writes (deferred to R4).
   - Delivery-brief event (R-WIN-02) — one brief + one onboarding task.

**Tests:**
- Readiness lists every unmet condition with its resolver (so the UI can offer "ask approver" / "upload signed contract" / etc.).
- Two concurrent `recordWin` calls → one wins, the other sees `409 ALREADY_WON`.
- Readiness after close-won: `canClose=false, unmet=['already_closed']`.

---

### Step 2.15 — Delivery brief

**Files:**
- `modules/sales/delivery/service.ts`
- `modules/sales/delivery/project-link.ts`
- `modules/sales/delivery/service.test.ts`

**Public API:**
```ts
export async function startBrief(ctx, dealId): Promise<DeliveryBrief>;
export async function updateBrief(ctx, briefId, input): Promise<DeliveryBrief>;
export async function submit(ctx, briefId): Promise<DeliveryBrief>;
export async function reviewDecision(ctx, briefId, { decision, reason }): Promise<DeliveryBrief>;  // accept | request_changes | cancel
export async function createLinkedProject(ctx, briefId): Promise<Project>;                        // idempotent
```

**State transitions (R-DEL-02):**
- `draft` → `submitted` → (`accepted` or `changes_requested` or `cancelled`)
- `changes_requested` → `draft` → …

**Acceptance (R-DEL-04):**
- `createLinkedProject` is idempotent on `(brief_id)` — one project per brief.
- Multi-project deals are an admin override that requires `deals:approve` + a reason.
- Brief acceptance writes to the audit outbox and emits `sales.delivery.brief-accepted`.

**Tests:**
- Submit → accept → `project_id` set once; a second accept call returns the same project.
- Reject with changes → brief moves back to draft; the project is NOT created.
- Cancel after Won — allowed but requires `deals:approve` + a reason; audit before/after.

---

## Phase R2C — Client (steps 2.16–2.21)

### Step 2.16 — Deals list + detail

**Files:**
- `packages/client/src/company/sales/deals/DealsPage.tsx`
- `packages/client/src/company/sales/deals/DealDetailPage.tsx`
- `packages/client/src/company/sales/deals/api.ts`
- `.../deals/deals-helpers.ts` (+ test)

**List:** filterable by stage, closer, expected close month; a kanban toggle for Sales HOD.

**Detail:** 5-state badges, commercials latest version summary, approval status, contract status, payments summary, delivery brief status, action rail with stage transitions.

---

### Step 2.17 — Commercials editor + proposals studio

**Files:**
- `.../proposals/ProposalEditorPage.tsx`
- `.../proposals/CommercialsTable.tsx`
- `.../proposals/ProposalPreview.tsx`

**Autosave** via the optimistic-lock pattern already used in payroll (adopt or lift the helper). Live subtotal/tax/total recomputed in the UI by calling the server math endpoint — never computed client-side.

**Publish dialog** shows the frozen version + the public-link copy UX (one-click copy, "regenerate" invalidates the previous token).

---

### Step 2.18 — Approvals queue

**Files:**
- `.../approvals/ApprovalsQueuePage.tsx`
- `.../approvals/ApprovalCard.tsx`

Pending approvals for the viewer, sortable by SLA remaining. Click opens the deal; the Approve / Reject / Return controls live inside the deal detail. SLA breach badge turns red at `sla_due_at - now < 15 min`.

---

### Step 2.19 — Payments + receipts

**Files:**
- `.../payments/PaymentsPage.tsx`
- `.../payments/ReportReceiptModal.tsx`
- `.../payments/AllocationEditor.tsx`

Payments page is scoped to Finance + Sales HOD. The receipt table shows `reported / verified / allocated` state transitions clearly; allocation is a per-receipt drawer that enforces the "sum = receipt amount" rule client-side AND server-side.

---

### Step 2.20 — Wins-to-record queue

**Files:**
- `.../wins/WinsToRecordPage.tsx`
- `.../wins/ReadinessPanel.tsx`

Lists deals that pass readiness; readiness panel on each row shows every unmet condition and a one-click deep-link to resolve (open approver, upload signed contract, etc.).

---

### Step 2.21 — Delivery brief

**Files:**
- `.../delivery/DeliveryBriefPage.tsx`
- `.../delivery/BriefSections.tsx`

Section-by-section editor mirroring the content shape. Submit → review state. Accept creates the project and navigates there.

---

## Cross-cutting concerns

### Authorization

- 7 new resource types in registry: `deal`, `commercials`, `approvalRequest`, `contract`, `paymentReceipt`, `paymentAllocation`, `deliveryBrief`.
- 15+ new actions: `deals:create|edit|view|forecast|allow-custom-terms|approve-contract|confirm-payment|record-win|approve|lose|cancel-after-win`, `payments:allocate|verify|refund|view|record`, `invoicing:*` (deferred).
- Protected: `deals:record-win` is super-admin-only + Sales HOD by default. `deals:confirm-payment` and `payments:verify` are protected per Finance policy.

### Observability

- `deal.state_changed`, `commercials.published`, `commercials.accepted`, `approval.decided`, `payment.verified`, `payment.allocated`, `delivery.brief_accepted`, `deal.won` — all audit-outbox events.
- Metrics:
  - `sales.deals.active{stage}` gauge
  - `sales.approvals.sla_breach_total` counter
  - `sales.payments.reconcile_lag_seconds` histogram
  - `sales.deals.time_to_close_seconds` histogram
  - `sales.deals.won_total` counter

### Secret handling

- Razorpay webhook secret in env (`RAZORPAY_WEBHOOK_SECRET`).
- Portal token: raw token never persisted — only its SHA-256 digest.
- Signature evidence stored as-is in the signer_evidence jsonb; redact in logs.

### Error contracts

| Code | HTTP | When |
|---|---|---|
| `DEAL_ALREADY_CLOSED` | 409 | Trying to transition a closed deal |
| `COMMERCIALS_VERSION_LOCKED` | 409 | Editing a published or accepted version |
| `COMMERCIALS_TOTAL_MISMATCH` | 422 | Client-sent totals disagree with server math |
| `APPROVAL_NO_ELIGIBLE_APPROVER` | 422 | No one can approve the request (unmet dimensions named) |
| `APPROVAL_REQUESTER_IS_DELEGATE` | 403 | Delegate rule violation |
| `CONTRACT_SIGNED_READ_ONLY` | 409 | Mutating a signed contract |
| `PAYMENT_DUPLICATE` | 409 | Duplicate `(provider, event_id)` or `(provider, bank_reference)` |
| `PAYMENT_NOT_VERIFIED` | 422 | Allocating against an unverified receipt |
| `PAYMENT_ALLOCATION_EXCEEDS_RECEIPT` | 422 | Allocation sum > receipt amount |
| `WIN_READINESS_UNMET` | 422 | Close-won blocked; unmet conditions in response body |
| `BRIEF_PROJECT_LINK_EXISTS` | 409 | Idempotent project link already created |

### Testing strategy

| Layer | Tool | Coverage expectation |
|---|---|---|
| Pure math (minor units) | Vitest | 100% branch coverage on `commercials/math.ts` |
| Repository (DB) | Vitest + testcontainers | All critical paths |
| HTTP routes | Supertest | Happy paths, auth denials, every error contract above |
| Portal (public) | Vitest + supertest | Signature, token lifecycle, rate limit, replay |
| Razorpay webhook | Vitest | Signature verify, dedup on event_id, state transitions |
| Workers | Vitest + fake BullMQ | SLA escalator idempotency; allocation integrity |
| Client UI | Vitest + Testing Library | Component logic, autosave, optimistic lock |
| E2E | Playwright | Lead → Deal → Proposal → Approval → Contract → Receipt → Won → Delivery brief |

Required e2e scenarios before R2 pilot:
1. Qualified lead becomes a deal; stage transitions through discovery → proposal.
2. Create commercials; publish version 1; recipient opens the public link and accepts.
3. Request approval that exceeds discount limit; approver approves; readiness ticks.
4. Record a Razorpay payment via webhook; verify; allocate full amount.
5. Record Win; delivery brief auto-created in draft; HOD accepts; project appears.
6. Partial refund on a receipt; `payment_status` reflects `partially_refunded`; net qualifying recalculated.

### Migration safety

- 0079–0084 are additive-only; no column drops.
- Each table ships with its RLS policy and the standard `updated_at` trigger.
- Feature flags:
  - `sales.deals.enabled`
  - `sales.proposals.enabled`
  - `sales.proposals.portal.enabled`
  - `sales.approvals.enabled`
  - `sales.payments.razorpay.enabled`
  - `sales.delivery.enabled`
- Rollback: feature flag off → the module's routes return 404; migrations stay in place.

### Documentation

- `docs/runbooks/sales-payments.md` — reconcile, void, refund, Razorpay webhook replay, dead-letter inspection.
- `docs/runbooks/sales-proposals-portal.md` — token issuance, revoke, rate-limit tune.
- `docs/architecture/sales-v1.1-r2.md` — the deal state machine, the approval ladder, the payment-to-win chain of custody.

---

## Acceptance tests mapped to PRD §23

| PRD AT | Covered by |
|---|---|
| AT19 (deal creation) | Step 2.7 tests |
| AT23–AT25 (commercials math) | Step 2.8 math tests |
| AT26 (proposal publish freezes) | Step 2.9 tests |
| AT27 (public portal lifecycle) | Step 2.10 tests |
| AT28–AT30 (approvals routing + SLA) | Step 2.11 tests |
| AT31 (contract signing evidence) | Step 2.12 tests |
| AT32–AT35 (payment verification, allocation, refunds, Razorpay replay) | Step 2.13 tests |
| AT36 (win readiness) | Step 2.14 readiness tests |
| AT37 (idempotent delivery project link) | Step 2.15 tests |
| AT38 (close-won → win recorder is sole writer) | Step 2.7 + 2.14 tests |

Deferred to later phases: AT41–AT42 (migration edges on legacy deals), AT48–AT56 (targets), AT62 (team roll-ups).

---

## Open questions blocking R2

1. **O5 — approval ladder.** The PRD lists this as unresolved. Needed before Step 2.11 ships to production; starter policies are illustrative only (R-APP-02).
2. **O6 — payment gateway.** PRD defaults to Razorpay. Confirmed? If a second gateway is on the roadmap, the webhook interface stays provider-agnostic (same pattern as the WhatsApp driver interface).
3. **Delivery brief content shape.** We ship a free-form jsonb + a UI schema today; a stricter schema per service type is a R3 nice-to-have.
4. **Multi-project allocation.** PRD says "explicit allocation" required but doesn't specify the shape. R2 scope: single project per brief; a `project_allocation` sub-table is a R3 follow-up.
5. **FX approval policy.** `payments:approve-fx` is listed above as deferred; cross-currency allocation blocks until it ships.

None of these block the schema work (2.1–2.6). Steps 2.11 (approvals) and 2.13 (payments) are the ones with hard dependencies.

---

## Pilot definition

End of R2 is the **R2 Pilot Milestone**. Pilot means:

- One tenant live
- At least one Sales HOD can close a won deal end-to-end: lead → deal → approved proposal → signed contract → verified receipt → recorded win → delivery brief → project.
- Public proposal link works for at least two recipients in production.
- Razorpay webhook running against a sandbox or production gateway (whichever the tenant has).
- Daily reconcile report (SQL dashboard) matching: deals won today ↔ receipts verified today ↔ allocations closed today.

Pilot exit criteria to move to R3:
- 14-day streak with zero payment-reconciliation discrepancies.
- Zero approval-routing defects open.
- Zero unauthorized `dealStage='closed'` writes.
- UAT sign-off from Sales HOD, Finance HOD, and one Sales Agent.

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Floating-point math slips into commercials | Lint rule forbidding `number` arithmetic on anything with `_minor` in the name; CI test. |
| Razorpay webhook signature spec changes | Journal every raw body; signature failures still land in `payment_webhook_event.outcome='invalid_signature'` and page oncall. |
| Public proposal link indexed by Google | Robots headers, same-origin referrer policy, 10-attempt IP cap, and the raw token never appears in server logs. |
| Approval ladder perception issues | Make the "no eligible approver" state visible with a named list of who can grant it. |
| Duplicate project created from brief | Idempotent on `brief_id`; the service re-fetches before INSERT. |
| Over-allocation of a receipt | Unique index on `(receipt, deal)` + a per-tx sum check inside the allocation transaction. |
| Target writes race with win record | R2 recorder only emits `sales.deal.won` to the outbox; the target writer (R4) consumes idempotently. |

---

End of plan.
