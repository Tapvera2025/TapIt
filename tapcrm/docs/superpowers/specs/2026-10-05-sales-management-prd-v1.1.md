# TapIt Sales Management System — PRD v1.1

Implementation-ready specification · 5 October 2026
Prepared for Archisman Dutta and the Tapvera product and engineering team

This document supersedes PRD v1.0 of 5 October 2026. It locks the client-specific decisions reached during product review (lead-source scope, bidding-based routing, dual-clock timezone handling, target management). Section numbering tracks v1.0 for cross-reference; sections marked **[v1.1]** are new or materially rewritten.

---

## Section 0 — Change log vs v1.0

| Section | Change | Reason |
|---|---|---|
| 1, 24 | Lead-source scope narrowed to Meta Ads, Website, Email, WhatsApp, Google Business Profile (telephony) | Confirmed by client; Google Ads / LinkedIn / IndiaMART removed from P0 |
| 6 | Section rewritten to describe only in-scope sources; GBP telephony intake added | Scope narrowing |
| 8 | **Bidding pool** is the primary routing mode for external leads; the fewest-open-leads router becomes a timed fallback | Confirmed client policy |
| 10 | Bid-pool card, pre-claim masking and claims-distribution dashboard added | Supports bidding mode |
| 19 | Clarified distinction between reporting and the new Target module | Avoids overlap |
| **19B** | **New: Target management (revenue targets, split attribution, extensions, multi-currency)** | New feature |
| 20 | Target entities and bidding fields added to the data model | Follows §8 and §19B |
| 21 | Dual-clock timezone rules formalised (operational vs customer) | Confirmed client policy |
| 23 | Bidding and target acceptance tests appended (AT43–AT55) | Covers new scope |
| 24 | Decisions list reduced to open items; recorded decisions moved to §0 locks | Implementation-ready |

Recorded locks (no further discussion required to begin coding):

| Lock | Value |
|---|---|
| L1 Lead sources (P0) | Meta Lead Ads, Website forms, Business email mailbox, WhatsApp Business, Google Business Profile (call-tracked) |
| L2 Primary routing | Bidding pool for L1 external sources; manual/import/outbound keep direct assignment |
| L3 Bidding timeout | 10 minutes to a fewest-open-leads auto-assign fallback (configurable) |
| L4 Pre-claim PII | Masked contact; service/location/budget/timeline visible; raw message truncated to 80 chars |
| L5 Reassignment authority | Super Admin and Sales HOD only; agents cannot reassign |
| L6 Sourcing credit on reassignment | Preserved by default; HOD may transfer it with an explicit audit toggle |
| L7 Operational timezone | `Asia/Kolkata` fixed at tenant level |
| L8 Customer timezone derivation | phone country code → form input → IP → fall back to `Asia/Kolkata` |
| L9 Target metric (v1) | Revenue only; deal-count and qualified-lead targets deferred to v1.2 |
| L10 Target attribution | Sourcer == closer: 100/0. Sourcer ≠ closer: 60 closer / 40 sourcer (tenant-configurable) |
| L11 Target period extension | Super Admin only. HOD cannot extend. Reason mandatory. |
| L12 Target currency | Target in setter's chosen currency; deals converted at `wonAt` rate; rate frozen on the achievement row |
| L13 Target achievement trigger | `deal.lifecycleStatus = won` only (requires verified advance per R-DEAL-03) |
| L14 Target amount basis | Net deal value excluding tax |

Open decisions (still required, listed in §24):

- O1 WhatsApp provider choice (Meta Cloud API / Interakt / Gupshup / Twilio)
- O2 GBP telephony partner (Exotel is default pick)
- O3 Default fairness caps (daily claim cap, active-lead cap)
- O4 Which Super Admin / HOD seats exist initially
- O5 Approval ladder (discount percentages per role)
- O6 Payment gateway (Razorpay default)

---

## Section 1 — Purpose and product decisions

Extend the existing modular monolith; do not fork Sales into a separate application. The workspace is Overview, My Work, Leads, Deals, Activities, Customers, Reports. Management holds configuration (territories, sources, integrations, automation, targets, settings).

Six product decisions govern the design:

1. **Direction and entry method are independent fields.** A receptionist typing a website enquiry is a manual-entry inbound lead; an agent typing a cold prospect is a manual-entry outbound lead.
2. **A lead is an enquiry; a deal is a qualified commercial opportunity.** Calls, callbacks and WhatsApp messages are activities, not pipeline stages.
3. **External leads are claimed, not assigned.** For sources in L1, every eligible agent in the matched pool sees the lead; the first to accept wins. Super Admin and Sales HOD can reassign post-claim.
4. **Ownership identities are separate.** `originatingAgentId` (first claimer / creator), `currentHolderId` (active handler during a call), `responsibleCloserId` (closer), `closedById` (final win recorder). Each is auditable.
5. **Winning requires evidence.** Approved current commercial terms, required contract, verified qualifying receipt. Moving a card cannot bypass these checks.
6. **A win produces a delivery brief.** Delivery acceptance and project creation are recorded; no win may disappear into chat.

Priority labels: P0 reliable core, P1 complete commercial and delivery, P2 later enhancements.

---

## Section 2 — Evidence and current implementation

Unchanged from v1.0. The baseline remains the `tapcrm` workspace, migrations 0052–0061, and existing Sales server/client modules. External integration behaviour is supported by provider references in §26.

### Capabilities that still need completion

| Capability | Current state | Required change |
|---|---|---|
| Manual lead entry | Form + `POST /api/leads` exists | Faster drawer, richer fields, duplicate check before commit, explicit direction |
| Lead lifecycle | Ten statuses | Split qualification, outcome, routing and activity state (per §9) |
| Duplicate detection | Digits-only phone, lowercased email | Country-aware phone parsing, provider idempotency, tenant-safe matching |
| Territory routing | Matcher + router + config | Replace with bidding pool (§8) as primary; retain router as fallback |
| Inbound assignment | `routingCandidates` returns `punchedIn: false`, `openLeadCount: 0` | Connect to attendance + workload (§8) |
| Handover eligibility | Hardcoded `not_punched_in`, selectable `false` | Connect to live-status + attendance |
| Deal creation after Interest | Writes `deal.creation_requested` activity only | Transactional Deal creation and conversion linkage |
| Callback ownership | Prefers `currentHolderId` over `ownerId` | Return to relationship owner post-handover |
| Reminder delivery | In-app rows exist; push deferred | Add real channel delivery statuses |
| Sales screens | Separate Leads / Callbacks / Handovers / Territories | Unified workspace, bid-pool view, deal board, role dashboards |
| Proposals and approvals | Described, not built | Build versioned documents, authority routing, customer responses |
| Finance link | Accounting facade with payroll intent | Add sales receipt contract + ledger integration |
| Delivery link | Clients + Projects exist | Explicit won-deal brief, review, idempotent project handoff |
| Automatic lead capture | None | Build Website, Meta, Email, WhatsApp and GBP-call adapters |
| Target management | None | Build v1.1 scope (§19B) |

---

## Section 3 — Goals, scope and success measures

### 3.1 Goals

Capture every valid enquiry; distribute inbound external leads fairly through claim-based bidding; make the next action obvious; preserve customer and commercial history; complete sales with verifiable evidence; measure performance against targets.

### 3.2 In scope

Manual and automatic intake, imports, duplicate handling, contact and company identity, bidding pool, qualification, communication records, activities, live handover, deals, proposals and quotes, commercial approvals, contracts, receipts, win controls, delivery briefs, account follow-up, renewals, **target management**, sales analytics, administration, operational monitoring.

### 3.3 Out of scope

Full project execution, payroll, general accounting, ad campaign creation, help-desk ticket implementation. These belong to existing or future modules; Sales shows status and ownership only.

### 3.4 Proposed targets (product KPIs)

Establish a two-week pilot baseline before promising any of these externally.

| Measure | Definition | Initial target |
|---|---|---|
| Capture reliability | Valid durable submissions with a linked result or explicit quarantine | 100 percent accounted for |
| Processing time | Receipt at TapIt to lead or review record | p95 below 60 seconds |
| First attempt | Recorded human outreach attempt within business-hour SLA | At least 90 percent |
| Bid-pool pickup | Leads claimed before the 10-minute fallback | At least 85 percent |
| Ownership | Active leads with owner; queued exceptions counted separately | At least 98 percent |
| Next action coverage | Active leads and open deals with a valid future or overdue action | At least 95 percent |
| Missed callbacks | Callbacks without outcome beyond grace | Below 5 percent |
| Controlled wins | Won deals passing receipt, authority and contract checks | 100 percent |
| Delivery handoff | Won deals with a brief and named reviewer | 100 percent |
| Target reconciliation | Won deals credited to a target row within 60 seconds | 100 percent |

---

## Section 4 — The complete flow in plain language

### 4.1 Short dictionary

| Word | Meaning |
|---|---|
| Lead | Someone who may buy, recorded with their enquiry |
| Contact | The person we speak to |
| Company | The business they represent |
| Deal | A real sales opportunity where we know what the customer wants |
| Activity | A call, message, meeting or task someone needs to do |
| Bid pool | The shared view of unclaimed external leads |
| Claim | An agent's action to take a bid-pool lead |
| Handover | Asking a more suitable salesperson to take an active conversation |
| Proposal | Our explanation of the work, price, timing and terms |
| Approval | Permission from someone allowed to accept a price or special condition |
| Advance | The first amount of money the customer pays |
| Won | The sale is officially confirmed after all required checks |
| Brief | Instructions Sales passes to the team that will do the work |
| Renewal | Selling the next period of an ongoing service |
| Target | Revenue (or deal) commitment for a scope and period |

### 4.2 Example — Rahul from first enquiry to delivery

Rahul fills in a Meta Lead Form for a clinic website. The notification arrives at TapIt; the worker fetches his answers via Graph API; the intake service checks for duplicates, resolves the matched Delhi–Website Development pool, and places the enquiry into the **bid pool** for every eligible agent in that pool. Each sees a card showing service, Pune location, ₹50k–₹1L budget bracket, timeline and a masked contact.

Rahul's card lives in the pool for up to 10 minutes. Rahul Shah (agent) clicks **Accept** at 00:42; the server locks the row, assigns `currentHolderId` and `originatingAgentId` to Rahul Shah, inserts a "Call within 10 business minutes" activity, and broadcasts a removal event to the three other agents still viewing.

Rahul Shah now sees full contact details. He calls, records *Connected*, moves the lead to Discovery, captures requirement and timeline, and schedules a demo. The lead becomes qualified; conversion creates a Deal pointed at the original lead and transfers ownership to Rahul Shah as the responsible closer.

Rahul Shah drafts a proposal: itemised services, 10 percent discount. The 10 percent falls within his authority limit, so no approval is needed. He publishes v1. The customer opens the public proposal link, requests one change, Rahul Shah publishes v2, and the customer accepts v2.

A signed contract is uploaded. Rahul the customer pays a ₹1,32,750 advance via Razorpay. Finance verifies the receipt; the Sales Head sees readiness all-green and records **Won**. TapIt freezes the attribution: originatingAgentId = Rahul Shah, responsibleCloserId = Rahul Shah, closedById = Sales Head.

**Target credit:** since sourcer == closer, the full net value excluding tax (₹2,25,000) credits Rahul Shah's October monthly target in INR. The achievement row stores date, dealId, amount and rate (1.0, same currency). His personal view updates immediately. The team roll-up on the Delhi dashboard reflects the new total.

A delivery brief is generated. The assigned Project Manager reviews, asks a clarification question, Sales confirms, the brief is accepted, and a project is created exactly once. Rahul Shah stays as account owner for follow-up.

### 4.3 Example — handover and split credit

Priya (agent) claims a different lead from the bid pool. Discovery shows the customer wants a complex multi-service engagement outside her comfort. She offers the call to her Team Lead Vikram, who accepts. Vikram records *Interested*, closes the handover, converts the lead and becomes `responsibleCloserId`. Priya remains `originatingAgentId`.

When Vikram wins the deal (net ₹5,00,000 excluding tax), the Target service writes two achievement rows:

- Vikram (closer): ₹3,00,000 (60 percent)
- Priya (sourcer): ₹2,00,000 (40 percent)

Both are shown on each person's "My Target" view with the deal reference and the split indicator.

### 4.4 What happens when the answer is no

Unchanged from v1.0 (Section 4.3). A no-answer lead stays in follow-up; a *later* buyer goes to nurture with a review date; a clear decline is closed with a reason; a cancelled sale keeps its history; refunds post as reversals, not deletions.

---

## Section 5 — People responsibilities and access

Position names describe default responsibility, not shortcuts around action-based authorization.

| Role | Records and actions | Commercial visibility |
|---|---|---|
| Sales Agent | Own leads, activities, bid-pool claims, handover offers | Own permitted closing work; other-closer commercials omitted |
| Sales Supervisor | Pool work, reassignment within scope, receiving calls, approved limits | Permitted pool or participant deals |
| Sales Team Lead | All subordinate pools, team forecast, higher authority | Own team chain and participant deals |
| Sales HOD | Department oversight, higher approvals, win recording, **lead reassignment**, **target assignment** | Department commercials; payment confirmation separately granted |
| Marketing | Sources, campaign summaries, connector administration if granted | Aggregates and approved segments; no default contact list access |
| Finance | Receipt verification, allocations, invoice linkage, refunds | Amounts needed for finance |
| Project Manager | Assigned briefs, accepted projects, linked agreed scope | Only linked delivery-relevant fields |
| Super Admin | Tenant configuration, operational override, **target assignment**, **target extension** | Subject to no-self-approval rule |
| Customer | Their shared proposal or contract | Only their shared snapshot |
| Integration service | Intake actions for one connected account | No human pipeline browsing |

**R-AUTH-01 P0.** Every read, list, search, attachment, export, report, job and real-time subscription applies tenant and record scope. Denied fields are absent from responses.

**R-AUTH-02 P1.** Cross-team deals are visible through sourcing or closing chains, subject to field restrictions. Source and close credit are separate measures. Overlapping manager scope must not double-count in consolidated reports.

**R-AUTH-03 P1.** Nobody may approve a request they raised, including Super Admin. For targets: Super Admin cannot assign a target to themselves. If no independent eligible approver / assigner exists, mark the request blocked with a configuration task.

---

## Section 6 — Lead capture [v1.1 — scope narrowed to L1 sources]

### 6.1 In-scope sources

Only these five sources are built for v1.1. Each has a canonical intake path and a dedicated adapter that normalises into the shared pipeline.

| Source | Mechanism | Priority |
|---|---|---|
| Website and landing forms | Server-to-server POST from the client website to `POST /api/lead-submissions` with a scoped intake credential | P0 |
| Manual phone / referral / walk-in | Employee Add Lead drawer | P0 |
| Meta Lead Ads (Facebook + Instagram) | Webhook notification + Graph API retrieval using stored Page token | P0 |
| Business email mailbox | OAuth-scoped subscription (Google Workspace or Microsoft 365) on configured folders | P0 |
| WhatsApp Business | Provider inbound events (choice of Meta Cloud API, Interakt, Gupshup, Twilio — see O1) | P0 |
| Google Business Profile | Call tracking via Exotel-equivalent provider; "website click" paths captured as regular website intake with GBP UTM | P0 (telephony) |
| CSV / XLSX bulk import | Dry-run then queued commit | P0 |

Sources explicitly **out of scope for v1.1**: Google Ads Lead Forms, LinkedIn Lead Sync, IndiaMART, Justdial, Partner API, outbound research. These remain in the architecture for later activation but no adapter is built.

### 6.2 Canonical intake pipeline (shared by all adapters)

Every source funnels through one intake service. Connectors MUST NOT write directly to lead tables.

```
Provider / form / user action
            │
            ▼
   Ingress adapter  ──► durably store raw payload (encrypted, 30 d retention)
                                 │
                                 ▼
                 canonical intake service
       (validate → map → dedupe → identify contact → resolve pool → emit event)
                                 │
                          ┌──────┴──────┐
                          ▼             ▼
                   bid-pool entry   direct assignment
                   (external L1)    (manual / import / outbound)
```

**R-INT-01 P0.** The canonical intake service is the sole writer of Lead and LeadSubmission rows for external sources. It records a submission, validates and maps fields, checks repeat delivery and business identity, creates or links an enquiry, resolves routing destination, creates the first-action task and emits an audited event.

**R-INT-02 P0.** Intake resolves tenant and connection from the configured route and verified credential or signature. It ignores any incoming request that attempts to set `organizationId`, employee permissions, payment state or `ownerId`.

**R-INT-03 P0.** For webhooks: validate the provider's signature on the raw body and durably store the accepted event before returning success. Processing runs asynchronously. If durable storage is unavailable, return a retryable error.

**R-INT-04 P0.** Preserve `sourceReceivedAt`, `providerSubmittedAt` (when supplied), `firstProcessedAt`, `connectorId`, provider account and form IDs, `externalLeadId`, `mappingVersion` and processing result. Store provider identifiers as strings so large numeric IDs do not lose precision.

**R-INT-05 P0.** Store raw payloads encrypted with restricted access; retain for 30 days operational. Normalised enquiry and attribution follow separate retention. Redact credentials and personal details from ordinary logs.

**R-INT-06 P0.** Submission outcome is one of `created | linked_existing | duplicate_delivery | quarantined | rejected | failed_retryable`. Every durably received production submission must have an inspectable outcome.

### 6.3 Meta Lead Ads

**R-META-01 P0.** Durably record every valid Meta lead notification with its `leadgen_id` and `form_id`. A worker retrieves the submitted answers using the server-held Page token and normalises them via the intake service. Permission errors and network errors are recorded distinctly. Never mark a notification processed when retrieval failed.

**R-META-02 P0.** Reconciliation runs every 15 minutes against the provider's retrieval window. Overlap interval + idempotency on `leadgen_id` means a missed webhook is recoverable without duplicates.

**R-META-03 P0.** Connection setup wizard: select Business Page, pick forms, grant `leads_retrieval` + `pages_manage_metadata` + `pages_read_engagement`, configure webhook, verify, submit a test lead. Test leads are flagged and never reach production KPIs or outreach.

### 6.4 Website and landing forms

**R-WEB-01 P0.** Submission is server-to-server from the client website to a scoped intake credential. Public-facing JavaScript never carries a privileged token. Where a direct public endpoint is unavoidable, lock it to one form ID, apply reCAPTCHA/rate limits and expose no CRM APIs.

**R-WEB-02 P0.** Capture name, phone or email, requirement, service, location, preferred contact method, consent evidence. Preserve supplied UTM fields and landing URL as unverified attribution. A website-submission UUID enforces repeat protection.

**R-WEB-03 P0.** If TapIt intake is unavailable, the client website must retain the enquiry and retry, or clearly report failure. Our acknowledgement means durably received, not acted on.

### 6.5 Email mailbox intake

**R-MAIL-01 P0.** Mail intake is restricted to approved mailboxes (`sales@…`, `enquiries@…`) and specific folders. OAuth scopes are folder-level where the provider supports it. Never ingest employees' entire mailboxes.

**R-MAIL-02 P0.** Match by `Message-ID` and `References` headers. An email from a **known contact** does not create a new lead — it appends to the existing enquiry or deal thread. An email from an **unknown sender** that classifies as a sales enquiry creates a new lead. Ambiguous cases enter a review queue.

**R-MAIL-03 P0.** Attachments are isolated, scanned, and stored under a scoped download endpoint. Forwarded quoted content is preserved but marked as such.

**R-MAIL-04 P0.** Auto-replies, bounces and out-of-office messages are detected and do not create leads.

### 6.6 WhatsApp Business

**R-WA-01 P0.** The adapter is provider-abstract (interface accepts Meta Cloud, Interakt, Gupshup, Twilio shapes behind one driver). Provider choice is O1 — all drivers implement the same intake contract.

**R-WA-02 P0.** Inbound WhatsApp events identify the connected business number and `external_message_id`. Known contacts: append to their lead or deal activity timeline. Unknown contacts: create a new lead only after classification (first-message intent + opt-in rules); delivery receipts, status updates and individual follow-up messages must not each become a new lead.

**R-WA-03 P1.** Outbound WhatsApp enforces the provider's 24-hour customer-service window and approved templates. Suppression is checked at send time (not just at sequence enrolment).

**R-WA-04 P0.** Store consent and the exact template version used for every outbound message.

### 6.7 Google Business Profile (call-tracked) [v1.1 — new]

**R-GBP-01 P0.** GBP intake is **telephony-based**. We publish an Exotel-tracked phone number on the GBP listing. The Exotel webhook sends call events (incoming, answered, missed, voicemail) to `POST /api/lead-submissions` with provider signature validation.

**R-GBP-02 P0.** An incoming call with no matching contact creates a new lead with `source = GBP`, `direction = inbound`, `entryMethod = provider_webhook`. The call activity records duration, answered flag, agent (if answered), recording URL (if captured), and timestamps.

**R-GBP-03 P0.** Missed calls still create a lead and surface it in the bid pool with status "missed call — return within 10 business minutes".

**R-GBP-04 P0.** Known-contact return calls append a call activity to the existing lead or deal; they do not create a new lead.

**R-GBP-05 P1.** Call recording is stored only where business consent policy and local law permit. The URL is scoped and audited; agents can play recordings on their own leads only.

**R-GBP-06 P0.** Website clicks from the GBP listing arrive via regular website intake (§6.4). The GBP origin is preserved by UTM parameters on the listing's website URL (`utm_source=gbp`).

### 6.8 Integration administration and recovery

**R-SYNC-01 P0.** Each connection surfaces: account identity, selected forms, operator, last successful production event, last test, last reconciliation, cursor, queue lag, captured count, linked count, quarantined count, current error. Status values: `draft | testing | active | degraded | reconnect_required | paused | disconnected`.

**R-SYNC-02 P0.** Temporary failures use exponential backoff with jitter: ~1 m, 5 m, 15 m, 60 m, then periodic up to 24 h; exhausted work moves to a dead-letter queue. Operators replay selected failures after correcting access or mapping; replay keeps the original external key.

**R-SYNC-03 P0.** Token revocation marks `reconnect_required` and alerts the operator. Invalid mappings mark `degraded` with affected submissions quarantined.

**R-SYNC-04 P0.** Cursors advance only after each page's events are durably stored. Backfills use a supported date window and overlap check. Show recoverable gaps and unrecoverable provider windows separately.

**R-SYNC-05 P0.** Pausing intake, pausing routing and pausing outbound are three separate controls, each independently audited.

**Acceptance (automatic intake).** One production test per enabled source reaches an accountable lead or review result; repeated and out-of-order events do not multiply leads; lost access visibly fails and recovers through replay; zero events disappear after a durable acknowledgement.

---

## Section 7 — Manual entry, imports and duplicates

Largely unchanged from v1.0. Summary:

**R-MAN-01 P0.** Add Lead drawer: name, phone or email, source, requirement required. Company, location, service, campaign, language, contact preference, notes optional. Advanced fields progressive.

**R-MAN-02 P0.** `entryMethod ∈ { manual, website, provider_webhook, provider_poll, import, partner_api }`. `direction ∈ { inbound, outbound }`. `createdBy` is the authenticated actor. These are not inferred from display names.

**R-MAN-03 P0.** Agent-created outbound: owner defaults to that agent. Manually recorded inbound: enters normal routing (direct assignment, not bid pool — see §8). Receptionist is not the default owner for inbound.

**R-MAN-04 P0.** Phone parsing is country-aware (libphonenumber). Original string retained, normalised E.164 stored where valid. Ambiguous local numbers trigger country selection or review.

**R-MAN-05 P0.** Duplicate check runs on blur, on submit, and at commit. Options: Open existing, Add enquiry to existing, Create separate enquiry with reason. Idempotency key covers retries and double-clicks.

**R-IMP-01 P0.** CSV / XLSX supported. Dry-run reports errors without writing. Template, 20 MB and 10 000 row limits. Column mapping saved per template.

**R-IMP-02 P0.** Commit by file digest + row key. Retries process each row once. Valid rows complete even while invalid rows remain actionable.

**R-IMP-03 P0.** Imports cannot create paid, approved or won records. Historical dates allowed only with explicit permission and recorded provenance.

**R-IMP-04 P1.** Rollback archives untouched records and preserves audit; cannot delete leads with later customer interaction.

**R-DUP-01 P0.** Unique provider submission key scoped by `(organizationId, connectionId, externalLeadId)` — database-enforced.

**R-DUP-02 P0.** Contact matching is normalised phone or email within a tenant. No automatic merging on name, company name or shared office number alone.

**R-DUP-03 P0.** Default: same verified contact + same service + existing active enquiry → link submission to that enquiry for review (not auto-assign to a new agent). Different service → new linked lead allowed with explicit reason.

**R-DUP-04 P1.** Manager-only merge of duplicate enquiries. Preserve both identifiers, original attribution, history, references. Redirect absorbed lead to survivor. Deals and receipts never silently reassigned.

---

## Section 8 — Assignment, bidding and availability [v1.1 — bidding pool is primary]

### 8.1 Two routing modes

| Mode | Applies to | Mechanism |
|---|---|---|
| **Bidding pool** | External L1 inbound: Meta Lead Ads, Website forms, GBP calls, qualified Email and WhatsApp enquiries | Lead is visible to every eligible agent in the matched pool; first `Accept` claim wins |
| **Direct assignment** | Manual entry, import, outbound, bid-pool fallback after timeout | Fewest-open-leads router with atomic capacity reservation |

### 8.2 Eligibility (shared by both modes)

**R-ROUTE-01 P0.** Assignment inputs: validated location, industry (where recorded), requested service/product, source, language, direction. The matching layer resolves the Sales team and pool before touching individual agents.

**R-ROUTE-02 P0.** Each territory has active dates, priority, rule predicates and team coverage. More specific matches win; explicit priority resolves business overlap. Administrators preview matching reasons before activating rules.

**R-ROUTE-03 P0.** An agent is **eligible** when:
- Active employee status
- Valid Sales capability on the matched pool
- Punched in to shift
- Not on break or leave
- Live-status active (presence)
- Under configured daily claim cap (O3)
- Under active-lead cap (O3)
- No conflicting accepted handover call

Stale or unavailable status is not assumed working. An open browser is not proof of availability.

**R-ROUTE-07 P0.** Sales integrates with Attendance, Breaks, Leave and Live-Status via an availability facade. Service failure behaviour is explicit: facade returns `UNAVAILABLE` → agent treated as ineligible, not as available.

### 8.3 Bidding pool — intake to claim

**R-BID-01 P0.** When intake resolves an external L1 lead and the matched pool has ≥ 1 eligible agent, the lead enters the bid pool for that pool. State: `pool_open`. All eligible agents in the pool receive a WebSocket push and the card appears in their My Work → Bid Pool.

**R-BID-02 P0.** The bid-pool card shows:
- Source and campaign name
- Service / product requested
- Location (city level)
- Budget bracket (if captured)
- Timeline / urgency
- First 80 characters of the message/requirement
- Masked contact: first + last initial of name, last 2 digits of phone
- Arrival time + aging indicator
- Live viewer count (debounced to 1 per 10 s)

The card MUST NOT expose full name, full phone, full email, raw message beyond preview, prior enquiry history, or attachments.

**R-BID-03 P0.** Claim is atomic. Server flow:

```
BEGIN TRANSACTION
  SELECT lead FOR UPDATE where id = ? AND bid_state = 'pool_open'
  IF NOT FOUND → return 409 { code: 'ALREADY_CLAIMED', claimedBy: <masked> }
  UPDATE lead SET
    bid_state           = 'claimed',
    currentHolderId     = <agent>,
    originatingAgentId  = <agent>,
    claimedAt           = now(),
    routingStatus       = 'assigned',
    leadStage           = 'new'
  INSERT activity: 'Call within 10 business minutes' (owner = <agent>, due = now + 10 bm)
  INSERT audit: 'bid_pool.claimed'
COMMIT
Broadcast 'lead.removed' to all other viewers
Return full lead detail to the claimer
```

**R-BID-04 P0.** Pass is personal. `POST /api/bid-pool/:leadId/pass` hides the card for the acting agent only and logs the event. It does not reduce visibility for others.

**R-BID-05 P0.** The bid-pool timeout is **10 business minutes** (configurable). Aging thresholds:

| Elapsed | Behaviour |
|---|---|
| 0–3 min | Normal card display |
| 3–7 min | Card border shifts to warning; push notification resent to eligible agents |
| 7–10 min | Pool expands to adjacent territory / pool; Supervisor and Sales HOD alerted |
| 10 min | Automatic fallback: direct-assignment router picks the fewest-open-leads eligible agent across the expanded pool |

**R-BID-06 P0.** If no eligible agent exists at intake time or at timeout: `bid_state = 'triage'`, lead appears in Supervisor and Sales HOD triage queue, Super Admin alerted. The lead is never silently dropped.

### 8.4 Direct assignment (manual, import, outbound, fallback)

**R-ROUTE-04 P0.** The direct-assignment router uses `fewest-open-leads` strategy with an atomic capacity reservation so simultaneous arrivals do not all pick the same agent. Workload definition: assigned active leads requiring work, overdue actions, active deals as configured. Round-robin is implemented but disabled by default pending test coverage.

**R-ROUTE-05 P0.** If direct-assignment finds no eligible agent, the lead enters the triage queue (same as §8.3 R-BID-06). A proposed five-business-minute triage alert and ten-business-minute first-attempt target are configurable.

### 8.5 Reassignment [v1.1 — formalised]

**R-REASSIGN-01 P0.** Only Super Admin and Sales HOD can reassign a claimed or assigned lead. Agents and Supervisors cannot. Team Leads cannot reassign across pools.

**R-REASSIGN-02 P0.** Reassignment UI collects: new owner (dropdown of eligible agents), reason (required text), transfer options:
- `pendingCallbacks: boolean` (default true)
- `scheduledActivities: boolean` (default true)
- `transferSourcingCredit: boolean` (default **false**)

**R-REASSIGN-03 P0.** `originatingAgentId` is preserved by default. Setting `transferSourcingCredit = true` requires an explicit audit entry and generates compensating target rows (if the lead has already contributed to a won deal in the current period, see §19B.9).

**R-REASSIGN-04 P0.** The previous holder is notified immediately with the reason. The new owner receives the lead in My Work with the same first-contact SLA clock applied from reassignment time.

**R-REASSIGN-05 P1.** Bulk reassignment (e.g., an agent going on leave) is available to Super Admin and Sales HOD. Dry-run shows all affected records before commit.

### 8.6 Fairness guards

**R-FAIR-01 P0.** Daily claim cap per agent per pool (O3; default none in v1.1 pilot, must be configurable).

**R-FAIR-02 P0.** Active-lead cap (O3; default 20 open leads per agent).

**R-FAIR-03 P0.** Cooling period after Pass: 5 minutes before the same agent sees the same lead again (if the lead is still open and re-expands into their pool).

**R-FAIR-04 P1.** Live claims-distribution panel on the Supervisor dashboard showing per-agent claim count today, with highlighting for agents > 2σ above or below pool average.

**R-FAIR-05 P1.** Weekly fairness report auto-generated for Sales HOD.

**Acceptance (routing).** Two concurrent claims of the same lead resolve to exactly one winner; a passed lead does not reappear within 5 minutes; a lead left in the bid pool for 10 minutes falls back to the auto-router; an agent on break cannot claim; a reassignment preserves sourcing credit by default; a bulk reassignment surfaces every affected record in dry-run before commit.

---

## Section 9 — Lead qualification lifecycle

Unchanged from v1.0. Key points:

Separate dimensions:
- `leadStage ∈ { new, contacted, discovery, qualified }`
- `leadOutcome ∈ { active, nurture, converted, closed_lost, archived }`
- `routingStatus ∈ { pool_open, triage, assigned, unassigned }` [extended with `pool_open` and `triage` for bidding]
- `currentHolderId` (owner or accepted temporary call receiver)
- `nextActivity` (derived from activities)
- `riskFlags ∈ { overdue, no_next_action, stalled, intake_issue }`

**R-LEAD-01 P0.** `Contacted` requires a recorded attempt with a result. `Connected` is a separate interaction result.

**R-LEAD-02 P0.** Qualification requires: suitable need, known next step, contact route, accountable owner. Service-specific gates (budget, decision-maker certainty) are configurable.

**R-LEAD-03 P1.** `converted` is set only when a Deal is created through the authorized conversion command. On creation failure the whole transaction rolls back or remains an explicitly pending request.

**R-LEAD-04 P0.** `closed_lost` requires a reason and notes for Other. `nurture` requires a future review action.

**R-LEAD-05 P0.** Stalled warnings are derived; changing a tag never resets the clock.

**R-LEAD-06 P1.** A fresh enquiry after loss creates a linked new lead using `previousLeadId`. A manager correction of an erroneous loss is a separately authorized reopen event.

Status migration mapping as per v1.0 §9.2 (unchanged).

---

## Section 10 — Workspace and screens [v1.1 — bid-pool UI added]

### 10.1 Navigation and Overview

Primary nav: Overview, My Work, **Bid Pool**, Leads, Deals, Activities, Customers, Reports, Targets. Management: team coverage, territories, sources/campaigns, integrations, automation, targets, settings.

**R-UX-01 P0.** Agent Overview surfaces: active bid-pool opportunities, due work, newly assigned leads, overdue actions, missing next steps. Managers see scoped team coverage, bid-pool health, queue age, response SLA, funnel, risk, forecast, target progress.

### 10.2 My Work

**R-UX-02 P0.** Aggregates: active bid-pool cards (sorted by age DESC), due activities, newly claimed/assigned leads, live handover offers, approvals, delivery queries. Priority order: live offers, overdue commitments, urgent inbound, upcoming actions, suggested follow-ups.

**R-UX-03 P0.** Completing an item updates the source record without duplicating tasks. Snooze preserves original deadline and SLA history.

### 10.3 Bid Pool page [v1.1 — new]

**R-UX-BID-01 P0.** Dedicated Bid Pool page shows all open bid-pool cards visible to the agent, sortable by age / source / service. Filters: source, service, location.

**R-UX-BID-02 P0.** Claim action from the card. Instant removal from other viewers' views. Claimer redirected to lead detail with the SLA clock running.

**R-UX-BID-03 P0.** Pass is a secondary action. "Why?" quick-pick: `wrong location`, `out of expertise`, `at capacity`, `other`. Reason is stored for analytics but not shown to other agents.

**R-UX-BID-04 P1.** Supervisor view: live claims distribution per agent, pool health (unclaimed count by age bucket), expired → fallback count by day.

### 10.4 Leads inbox and contextual detail

**R-UX-04 P0.** Saved views: Mine, New, Uncontacted, Due today, Overdue, Nurture, Stalled, Unassigned, Duplicates (authorized). Filters: source, campaign, owner, pool/team, territory, service, stage, dates.

**R-UX-05 P0.** Default table columns: contact, company, enquiry, stage/outcome, owner, last attempt, next action, source, risk. Opening a row shows a side panel with contact methods, requirement, qualification, next action, chronological history. Full detail page for shareable deep links.

### 10.5 Deals and other screens

**R-UX-06 P1.** Deals: board + list, scoped totals, expected close, probability, age, next activity. Board columns: Discovery, Proposal, Negotiation, Closing. Won / Lost / Cancelled in outcome views.

**R-UX-07 P1.** Deal detail: five independent states, readiness checklist, permitted commercials, documents, approvals, receipts, contacts, activities, delivery brief. Drag/drop changes `dealStage` only; a successful Close Won command sets `closed + won` atomically.

**R-UX-08 P0.** Activities: list, day/week calendar, due-work views.

**R-UX-09 P0.** WCAG 2.2 AA: keyboard operation, screen-reader labels, visible focus, non-colour status cues, local dates with timezone, safe destructive-action confirmations, retained drafts. Mobile: one action at a time; no compressed desktop boards.

### 10.6 Targets page [v1.1 — new; see §19B for behaviour]

Agent view: My Target (current period + history). Manager view: Team Collection (per-member grid). Super Admin / HOD view: Target Admin (all active targets, bulk-create, extension log).

---

## Section 11 — Activities, communication, reminders

Unchanged from v1.0.

**R-ACT-01 P0.** Activity types: `call | callback | email | whatsapp | meeting | demo | task | proposal_follow_up`.
**R-ACT-02 P0.** Statuses: `planned | in_progress | completed | missed | cancelled`. Rescheduling preserves original due time and creates a replacement linked to the original.
**R-ACT-03 P0.** Every active assigned lead and open deal needs a next action.
**R-ACT-04 P0.** Callback reminders default to 60 min before, 15 min before, due time; 30-min missed grace. Skip past thresholds when a callback is created late.
**R-ACT-05 P0.** Record `queued | sent | delivered | read | failed` only when the channel provides evidence.
**R-COMM-01 P1.** Integrated email, WhatsApp, telephony use provider IDs; visibility scoped.
**R-COMM-02 P0.** Pre-integration, Call/Email/WhatsApp open device apps and are labelled manual.
**R-COMM-03 P1.** WhatsApp enforces current provider template rules and the 24-hour customer-service window.
**R-COMM-04 P1.** Quiet hours use the **customer's timezone** (§21) with a documented business default fallback.

---

## Section 12 — Live handover and qualification conversion

Unchanged from v1.0.

**R-HAND-01 P0.** Permitted active Supervisors and Team Leads with availability shown; originating agent's chain pinned.
**R-HAND-02 P0.** Only the current handler offers. Offer state: `pending | accepted | declined | expired | cancelled`. Expiry 5 minutes. Offer acceptance moves `currentHolderId` only.
**R-HAND-03 P0.** No eligible receiver → configured queue with atomic first claim; scope deliberately bounded.
**R-HAND-04 P1.** Receiver records `interested | callback | not_interested`. Interested → create Deal with authorized closer. Callback → relationship owner (`originatingAgentId`) receives the task; current holder restored.
**R-HAND-05 P1.** Conversion and disposition are atomic and idempotent.
**R-HAND-06 P0.** Acceptance time, disposition time and summaries preserved. Finalized results corrected by annotations, not overwritten.
**R-HAND-07 P1.** Escalation chain preserved; actual telephony bridging requires a provider.

---

## Section 13 — Deal management and commercial state

Unchanged from v1.0. Summary:

**R-DEAL-01 P1.** Deal fields: number, originating lead or direct-entry reason, company, buying contacts, service, title, scope summary, `originatingAgentId`, `responsibleCloserId`, currency, expected close, probability, commercials version, five states.

**R-DEAL-02 P1.** Sourcing attribution permanent (overridable only via explicit reassignment with audit, §8.5). Current responsible closer changes via authorized transfer. `closedById` recorded at Won.

**Five states:**
- `dealStage ∈ { discovery, proposal, negotiation, closing, closed }`
- `approvalStatus ∈ { not_required, pending, approved, rejected }`
- `contractStatus ∈ { not_required, draft, sent, signed, voided }`
- `paymentStatus ∈ { unpaid, partial, advance_confirmed, paid, partially_refunded, refunded }`
- `lifecycleStatus ∈ { open, won, lost, cancelled }`

**R-DEAL-03 P1.** Close Won requires: `approvalStatus = approved` or policy `not_required`; current required contract signed or policy `not_required`; net verified receipt allocations meeting the configured advance; agreed scope ready; authorized Sales win recorder. One command sets `dealStage = closed` and `lifecycleStatus = won`.

**R-DEAL-04 P1.** Readiness screen lists each unmet condition and who can resolve it.

**R-DEAL-05 P1.** Lost deals need structured reasons. Cancellation after Win is a separate event. Partial refunds adjust payment state without cancelling the sale.

**R-DEAL-06 P1.** Default stage probabilities: 20/40/60/85 percent for Discovery/Proposal/Negotiation/Closing. Manual overrides require permission + reason.

---

## Section 14 — Proposals, quotations, commercial calculations

Unchanged from v1.0. Summary:

**R-PROP-01 P1.** Deal commercials: itemised services, quantities, unit prices, currency, discounts, tax categories, milestones, advance requirements, validity, scope, exclusions, timeline, terms.

**R-PROP-02 P1.** Server-side calculation in integer minor units or fixed-precision decimal. Item vs document discount order specified.

**R-PROP-03 P1.** Proposal explains work and offer; quote is the structured price snapshot. Both derive from the same versioned commercials.

**R-PROP-04 P1.** Drafts autosave with optimistic version checks. Publishing freezes scope, prices, terms, approval references, PDF checksum. Editing creates new version and may re-evaluate approvals.

**R-PROP-05 P1.** Pre-send checks: authority, recipient, contact permission, expiry, required fields.

**R-PROP-06 P1.** Templates editable; role restrictions apply to previews and downloads.

**R-PORTAL-01 P1.** Public proposal link: high-entropy revocable token, expiry, hashed stored token, no sequential IDs, no search indexing, restrictive referrer policy. High-value offers can require recipient verification.

**R-PORTAL-02 P1.** Public page shows version, scope, exclusions, total, tax assumptions, schedule, expiry, contact person. Actions: Accept this version, Request change, Ask a question. Version acceptance records identity evidence, time and document checksum.

**R-PORTAL-03 P1.** Expired / revoked / superseded versions unviewable or non-acceptable.

**R-PORTAL-04 P1.** Engagement telemetry is labelled estimates, not proof.

**R-PORTAL-05 P1.** Engagement may create suggested follow-up but never approves pricing, qualifies, or marks Won.

---

## Section 15 — Commercial approvals and authority

Unchanged from v1.0. Decision O5 (approval ladder) still open.

**R-APP-01 P1.** Check total value, discount, margin (where cost data reliable), nonstandard terms, contract requirements, advance exceptions against the actor's limits. Independent dimensions.

**R-APP-02 P1.** Default illustrative discount limits — must be confirmed before activation.

**R-APP-03 P1.** Route to lowest eligible independent authority. No eligible approver → visible blocked state.

**R-APP-04 P1.** Decisions: Approve, Reject, Return for revision. Changes to value, items, scope, discount, advance or controlled terms invalidate relevant approval.

**R-APP-05 P1.** Response SLA 4 business hours, escalation to next eligible authority.

**R-APP-06 P1.** Delegates require equivalent authority. No onward delegation; no requester as delegate.

---

## Section 16 — Contracts, payments, official wins

Unchanged from v1.0. Payment gateway default = Razorpay (O6).

**R-CON-01 P1.** Contract requirement from approved policy. Store draft, issuance, recipient, signed artifact, signer evidence, version, checksum.

**R-CON-02 P1.** Issuance references approved quote version. Material revision after signing → amendment or replacement workflow.

**R-PAY-01 P1.** Distinguish payment request, reported payment, verified receipt, allocation, accounting posting. Only `deals:confirm-payment` or Finance permission verifies.

**R-PAY-02 P1.** Bank transfers: transaction reference, payer, amount, currency, date, independent reconciliation. Razorpay webhooks: raw-body signature validation, dedup on provider event ID, out-of-order tolerance.

**R-PAY-03 P1.** Authorized / initiated payments do not count. Only confirmed capture / success evidence qualifies.

**R-PAY-04 P1.** Unique provider / bank receipt identity. One allocation per amount. Cross-currency receipts require approved conversion record.

**R-PAY-05 P1.** Verification creates receipt + durable accounting event together. Persist explicit sales posting intent through new facade contract.

**R-PAY-06 P1.** Refunds / chargebacks use authorized reversal events. Recalculate net qualifying amount.

**R-WIN-01 P1.** Sales HOD or configured independent Sales authority runs the wins-to-record queue. Close command reads current deal version, approvals, contract, receipts under concurrency control. Records `closedById`, `recordedBy`, `wonAt`, agreed version, source/close attribution. **Also triggers target achievement writes (§19B.6).**

**R-WIN-02 P1.** One delivery brief + one onboarding task via idempotent event.

---

## Section 17 — Sales to delivery and account management

Unchanged from v1.0.

**R-DEL-01 P1.** Brief: customer contacts, agreed services, exact proposal/contract version, deliverables, exclusions, promised dates, dependencies, customer assets, access readiness, outstanding questions, payment readiness.
**R-DEL-02 P1.** Brief states: `draft | submitted | changes_requested | accepted | cancelled`. Review target: 1 business day.
**R-DEL-03 P1.** Acceptance requires clear scope + feasibility.
**R-DEL-04 P1.** Accepted brief creates or links project exactly once. Multi-project deals require explicit allocation.
**R-ACC-01 P1.** Reuse existing clients area; map by contact/company. Account owner = active relationship owner; sourcing attribution retained separately.
**R-ACC-02 P1.** Customer view connects contacts, enquiries, deals, documents, project milestones, verified receipts, invoice references, planned follow-ups.
**R-ACC-03 P2.** Recurring services: term start/end, renewal owner, expected renewal value, reminders at 60/30/7 days before expiry.

---

## Section 18 — Automation and lead scoring

Unchanged from v1.0.

**R-AUTO-01 P1.** Versioned allow-listed rule engine: event, conditions, action, schedule, cooldown, owner. Starter rules: new-lead first task, queue alerts, missed callback escalation, no-next-action warning, pending approval escalation, won-brief creation. **Add: bid-pool fallback timeout, target period rollover.**

**R-AUTO-02 P1.** No arbitrary SQL / JavaScript / unbounded loops. Outbox for side effects. Deduplicate by rule + event + record.

**R-AUTO-03 P2.** Sequences: ordered call/message/task steps, business-hour delays, exit conditions.

**R-SCORE-01 P2.** Transparent scoring: declared fit + observed engagement. Separate readiness, engagement, risk.

**R-SCORE-02 P2.** AI used for summaries, suggestions, drafts with record references. Human review for customer messages. AI never approves pricing, verifies money, marks Won.

---

## Section 19 — Reporting (operational metrics)

Unchanged from v1.0 in scope. The **Targets module (§19B)** is distinct — it is a planning + attribution system, not a report. Reports read Target data as an additional dimension.

**R-REP-01 P1.** Scoped lead volume, intake failures, response attempts, connected rate, qualification, lead-to-deal conversion, deal win/loss, stage aging, callbacks, handover acceptance/disposition time, approval delay, source performance, delivery handoff time, renewal pipeline. **New in v1.1:** bid-pool pickup time, bid-pool fallback count, per-agent claim distribution, per-agent/target achievement rate.

**R-REP-02 P1.** Response SLA measures business-time from `providerSubmittedAt` where reliable; TapIt receipt separately. Lead conversion = linked Deal creation. Deal win rate = won / (won + lost) for the selected closed cohort.

**R-REP-03 P1.** Open weighted forecast = sum of permitted net deal values × current stage probability. Gross vs net separated.

**R-REP-04 P1.** Sourcing and closing credit use separate attribution fields and leaderboards. First enquiry source immutable.

**R-REP-05 P1.** Target reports: period, scope, achievement, pacing. See §19B.

**R-REP-06 P1.** Historical currency conversion stores source, rate, effective date. Closing-date rates for historical booked results.

---

## Section 19B — Target Management [v1.1 — new section]

### 19B.1 Purpose

Super Admin and Sales HOD plan and track revenue commitments against individuals and teams. Won deals credit targets automatically; refunds post reversals. Managers see team-level roll-ups; agents see their own progress. Multi-currency supported with frozen conversion rates.

### 19B.2 Entities

```
TargetAssignment
  id                    uuid
  organizationId        uuid         not null
  scope                 enum         (agent | team | department | org)
  scopeId               uuid         references agent/team/dept
  setBy                 uuid         (Super Admin or Sales HOD)
  metric                enum         (revenue)        -- v1.1 locked to revenue
  amount                decimal(14,2)
  currency              char(3)
  period                enum         (weekly | monthly | quarterly | custom)
  periodStart           date         inclusive
  periodEnd             date         inclusive (mutable via extension)
  originalPeriodEnd     date         immutable
  status                enum         (draft | active | closed | voided)
  notes                 text
  version               int          optimistic concurrency
  createdAt, updatedAt  timestamptz
  INDEX (organizationId, scope, scopeId, periodStart, periodEnd)

TargetAchievement
  id                    uuid
  organizationId        uuid         not null
  targetId              uuid         references TargetAssignment
  dealId                uuid         references Deal
  userId                uuid         the person credited
  sharePercent          numeric(5,2) 0.00 – 100.00
  dealNetValue          decimal(14,2) in deal currency
  dealCurrency          char(3)
  convertedAmount       decimal(14,2) in target currency
  conversionRate        decimal(18,8)
  conversionRateDate    date
  conversionRateSource  text
  reason                enum         (deal_won | deal_refund | deal_cancel | credit_transfer | manual_adjustment)
  originalAchievementId uuid         references self (for reversals)
  bookedAt              timestamptz  (= deal.wonAt for deal_won)
  createdBy             uuid         (service or user)
  createdAt             timestamptz
  INDEX (targetId), INDEX (userId, bookedAt), INDEX (dealId)

TargetAuditEvent
  id, organizationId, targetId, actorId
  event    enum (created | updated | extended | voided | closed)
  before   jsonb
  after    jsonb
  reason   text
  at       timestamptz
```

**R-TGT-01 P0.** `TargetAchievement` rows are append-only. Reversals are new negative rows pointing to the original via `originalAchievementId`.

**R-TGT-02 P0.** Achieved amount for a target is `SUM(convertedAmount)` across its achievement rows, computed on demand with indexed access.

### 19B.3 Authority

**R-TGT-03 P0.** Target assignment authority:

| Setter | Can assign to |
|---|---|
| Super Admin | Any scope (agent, team, department, org) |
| Sales HOD | Agents and teams within their department |
| Sales Team Lead | Agents within their team (configurable; default off in v1.1 pilot) |
| Agent | Nobody |

**R-TGT-04 P0.** No self-assignment. If a Super Admin needs an individual target, another Super Admin must set it. If no independent Super Admin exists, the org-level target applies and no individual target is created.

**R-TGT-05 P0.** Only Super Admin can extend a target's `periodEnd`. Reason required. `originalPeriodEnd` is never mutated.

**R-TGT-06 P1.** Voiding (cancelling) a target is Super Admin only. Voided targets stop accumulating achievements but keep their history for audit.

### 19B.4 Periods

**R-TGT-07 P0.** Supported periods:

| Period | Default definition | Tenant-configurable |
|---|---|---|
| `weekly` | Monday 00:00 – Sunday 23:59 in operational timezone | Day-of-week start |
| `monthly` | Calendar month in operational timezone | Fiscal month start day |
| `quarterly` | Calendar quarter | Fiscal quarter start |
| `custom` | Explicit `periodStart` and `periodEnd` dates | — |

**R-TGT-08 P0.** `periodStart` and `periodEnd` are dates (not timestamps). "Within period" check uses `wonAt` → date-in-operational-timezone → compared to range.

### 19B.5 Attribution

**R-TGT-09 P0.** When a deal transitions to `lifecycleStatus = won`, the Target service calculates credit:

```
attributions = []
if deal.originatingAgentId == deal.responsibleCloserId:
    attributions = [{ userId: deal.responsibleCloserId, share: 100 }]
else:
    split = tenantConfig.targetSplit  // default { closer: 60, sourcer: 40 }
    attributions = [
      { userId: deal.responsibleCloserId, share: split.closer },
      { userId: deal.originatingAgentId,  share: split.sourcer }
    ]
```

**R-TGT-10 P0.** Default split is 60 closer / 40 sourcer (L10). Tenant configurable with constraint `closer + sourcer = 100` and `closer >= sourcer`.

**R-TGT-11 P1.** Per-deal override allowed only with Super Admin authority; stored as `deal.targetSplitOverride` with reason and audit event.

**R-TGT-12 P0.** Team-level targets accumulate the achievements of all members of the team at the time of the win. A member leaving the team mid-period keeps achievements already credited in that period; new wins credit the new team only.

### 19B.6 Achievement write

**R-TGT-13 P0.** On `deal.won`:

```
value_basis = deal.netValue        -- excludes tax (L14)
for each attribution:
    contribution = value_basis * attribution.share / 100
    activeTargets = find TargetAssignment where
        scope = 'agent' AND scopeId = attribution.userId
        OR scope = 'team' AND scopeId IN teamsOf(attribution.userId, deal.wonAt)
        OR scope = 'department' AND scopeId IN departmentsOf(attribution.userId, deal.wonAt)
        OR scope = 'org' AND scopeId = organizationId
      WHERE status = 'active'
        AND periodStart <= dateOf(deal.wonAt) <= periodEnd
    for each target:
        converted = convertCurrency(contribution, deal.currency, target.currency, deal.wonAt)
        INSERT TargetAchievement {
          targetId, dealId, userId: attribution.userId,
          sharePercent: attribution.share,
          dealNetValue: value_basis, dealCurrency: deal.currency,
          convertedAmount: converted.amount,
          conversionRate: converted.rate,
          conversionRateDate: deal.wonAt::date,
          conversionRateSource: converted.source,
          reason: 'deal_won',
          bookedAt: deal.wonAt,
          createdBy: 'target-service'
        }
```

**R-TGT-14 P0.** Write runs within the same database transaction as the deal transition OR via a durable outbox consumer that is idempotent on `(dealId, userId, reason)`. If the write fails synchronously, the deal state does not roll back — the outbox retries. Target UI shows the achievement within 60 seconds; monitoring alerts on stale queue.

### 19B.7 Multi-currency

**R-TGT-15 P0.** Conversion rate is captured on the `wonAt` date. Rate source order:

1. Configured FX API (if enabled; O-FX)
2. Tenant-maintained rate table (default for v1.1 pilot)
3. Fallback: 1.0 only if `deal.currency == target.currency`

A rate miss where currencies differ fails the achievement write and alerts admins. No silent fallback to 1.0 cross-currency.

**R-TGT-16 P0.** Historical achievements never recompute. The frozen `conversionRate` on each row remains authoritative.

**R-TGT-17 P1.** Manager roll-up view accepts a `displayCurrency` and converts member target amounts at today's rate for the summary display only. Per-member drill-downs show native target currency.

### 19B.8 Refunds, cancellations, compensations

**R-TGT-18 P0.** On `deal.refund` (full):

```
originalAchievements = TargetAchievement where dealId = ? and reason = 'deal_won'
for each original:
    INSERT TargetAchievement {
      targetId, dealId, userId: original.userId,
      sharePercent: original.sharePercent,
      dealNetValue: -original.dealNetValue,
      dealCurrency: original.dealCurrency,
      convertedAmount: -original.convertedAmount,
      conversionRate: original.conversionRate,         -- same rate as original (no recomputation)
      reason: 'deal_refund',
      originalAchievementId: original.id,
      bookedAt: refund.at,
      createdBy: 'target-service'
    }
```

**R-TGT-19 P0.** Partial refunds post a proportional reversal. If `refundRatio = refundAmount / deal.grossValue`, write `convertedAmount = -original.convertedAmount * refundRatio` on a new row.

**R-TGT-20 P0.** Deal cancellation after win (not a refund) posts a full `deal_cancel` reversal.

**R-TGT-21 P0.** Reversals book to the **current period's** TargetAssignment (based on reversal date), not the original period. The original row stays in the original period. Reports can filter either way; by default agent "My Target" shows net achievements under the row's `bookedAt` date.

**R-TGT-22 P1.** `credit_transfer` reversals occur when §8.5 reassignment sets `transferSourcingCredit = true` and the deal has already won:
- Negative row for the original sourcer
- Positive row for the new sourcer
- Both carry `reason = 'credit_transfer'` and `originalAchievementId` on the negative row

### 19B.9 Timeline extensions

**R-TGT-23 P0.** Extension API:

```
POST /api/targets/:id/extend
Body: { newPeriodEnd: 'YYYY-MM-DD', reason: 'string' }
Auth: Super Admin only
```

- Validation: `newPeriodEnd > current periodEnd`; `reason` non-empty; status `active`.
- Effect: update `periodEnd`; `originalPeriodEnd` untouched; insert `TargetAuditEvent event = extended`.
- Downstream: deals winning in the extended window now credit this target. Deals that already won and were credited remain unchanged.
- Notification: the person whose target was extended receives an in-app notification stating the reason.

**R-TGT-24 P0.** Extensions are visible on every view of the target: "Extended by 10 days from original (reason: Diwali shutdown)".

### 19B.10 UI contracts

**A. Agent view — `/targets/my`**

- Current period card: amount achieved / amount target in native currency, percentage, pacing status (`ahead | on_track | at_risk | behind`), days remaining.
- Contribution list: deal reference, booked date, contribution amount, share indicator (closer / sourcer / solo), currency.
- Period history: last 6 periods achieved vs target.
- Pacing calculation: `expectedAchievementToDate = targetAmount * (dayOfPeriod / totalDays)`; status buckets `>= 95% ahead`, `>= 85% on_track`, `>= 70% at_risk`, `< 70% behind`.

**B. Manager view — `/targets/team/:teamId`**

- Team card: team target (if any), aggregated achievement across members (converted to display currency).
- Member grid: name, target, achieved, percentage, pacing badge.
- Filter: period selector, member search, pacing filter.
- Actions: set / edit target (if authorized), extend target (Super Admin only).
- Export: CSV with native currencies preserved.

**C. Super Admin view — `/targets/admin`**

- Grid of all active targets (filter: period, scope, status).
- Bulk-create wizard: period template → scope selection → per-member amount (flat or percentage) → confirmation.
- Extension log: every extension with before/after dates, reason, actor.
- Audit log: every target assignment edit.

### 19B.11 API contracts

```
POST   /api/targets                                 create assignment
GET    /api/targets                                 list (filtered by scope/period)
GET    /api/targets/:id                             detail with achievements
PATCH  /api/targets/:id                             edit (voiding, notes); amount edit requires new version
POST   /api/targets/:id/extend                      Super Admin only
POST   /api/targets/:id/void                        Super Admin only
GET    /api/targets/:id/achievements                paginated achievements
GET    /api/targets/my                              current user's active targets + progress
GET    /api/targets/team/:teamId                    team rollup; manager scope enforced
GET    /api/targets/admin                           Super Admin / HOD admin grid
```

Every target command returns `expectedVersion`; stale version returns `409 CONFLICT`.

### 19B.12 Edge cases (reference)

| Case | Behaviour |
|---|---|
| Deal won in extended window after original end | Credited to this period (which now includes the extended window) |
| Deal won but target voided before win | Not credited to voided target; may be credited to broader scope targets (team, dept, org) still active |
| Agent moves team mid-period | Individual target unchanged; team target now sums new team's members from move date; past wins in prior team stay in that team's roll-up |
| Agent leaves company mid-period | Target status → `closed`; `periodEnd` set to departure date; achievements through that date remain |
| Agent reinstated | New target assignment required; no merge with prior |
| Multiple active targets of same scope + overlapping periods | Both receive credit; UI warns Super Admin on creation |
| Credit transfer on reassignment | §19B.8 R-TGT-22 compensating rows |
| Currency rate missing cross-currency | Achievement write fails with alert; manual admin intervention required |
| Overlapping periods (weekly inside monthly) | Both are independent targets and both receive full credit for a win within both ranges |

**Acceptance (targets).** A simultaneous Won + target-extend request returns a version-consistent result; refunds reduce current period, never retroactively edit a prior period; a Super Admin cannot assign a target to themselves; a HOD cannot extend any target; cross-currency wins are credited at the frozen `wonAt` rate; voided targets stop accruing immediately; the achievement view reconciles to within 60 seconds of a Won event.

---

## Section 20 — Data model and system contracts [v1.1 — bidding + target entities added]

### 20.1 Architecture

Preserve the TypeScript monorepo and modular monolith. Sales owns lead and deal operations. Connectors and jobs call scoped domain services; they never bypass authorization or data-access layers.

Synchronous transactions for operations that must succeed together (conversion + disposition, receipt + allocation, deal.won + target achievement where configured). Transactional outbox for post-commit side effects (messages, document generation, provider calls, project creation, target achievement when async).

### 20.2 Entities (changes from v1.0 in **bold**)

| Entity | Key fields | Integrity rule |
|---|---|---|
| Contact | tenant, name, phones/emails, preferences, company links, **timezone** | Identity may back multiple enquiries |
| Company | tenant, name, domain, billing reference | Name alone is not a unique key |
| Lead | contact, enquiry, source, direction, entryMethod, owner, stage/outcome, **bidState**, **claimedAt**, **originatingAgentId**, **currentHolderId** | `converted` requires valid deal relation |
| LeadSubmission | connection, external key, timestamps, mapping, outcome, payload reference | Unique accepted submission key |
| **BidPoolView** | leadId, agentId, firstSeenAt, lastSeenAt, action (`viewed | passed | claimed`) | For fairness analytics; append-only |
| Source, Campaign | internal + provider mapping | Historical attribution survives deactivation |
| Connector | tenant, account/form bindings, secret reference, status, cursor | No cross-tenant ambiguity |
| RoutingDecision | lead, rules version, candidate snapshot, result, reason, **mode** (`bidding | direct | fallback`) | Preserves original and reassignment decisions |
| Activity | parent refs, assignee, due time, result, replacement link | Same-tenant parent |
| Interaction | provider/manual origin, external message/call ID, evidence | Message retries don't duplicate |
| Handover | from/to, lead, offer state, acceptedAt, disposition, chain | One active offer per conversation |
| Deal | source lead, owners, service, currency, five states, **originatingAgentId**, **responsibleCloserId**, **closedById**, **netValue**, **targetSplitOverride?** | Guarded outcomes and version check |
| CommercialVersion | items, amounts, scope, terms, approval policy version | Published versions immutable |
| ProposalVersion | commercial version, recipients, checksum, expiry | Customer response binds exact version |
| ApprovalRequest | requester, version, authority route, decisions | No self-approval |
| Contract | deal/version, signed file, signer evidence, status | Verified current agreement |
| Receipt, Allocation | provider/bank key, verified amount, deal allocation, reversals | Allocation ≤ net availability |
| DeliveryBrief | won deal snapshot, reviewer, state, acceptance | One default brief per win |
| Account, Renewal | client mapping, owner, service terms, next opportunity | Historical deals not overwritten |
| **TargetAssignment** | scope, scopeId, metric, amount, currency, period, dates, originalPeriodEnd, status | See §19B.2 |
| **TargetAchievement** | targetId, dealId, userId, share, amount, rate, reason | Append-only; signed amounts |
| **TargetAuditEvent** | targetId, actor, event, before/after, reason | Immutable |
| AutomationRun | rule version, event key, result, side-effect keys | Repeat event has no repeat side effect |

All new tables carry `organization_id` and tenant-consistent foreign keys. Money fields are fixed precision or minor units plus currency. Timestamps are UTC instants; **date-only fields (period boundaries, rate dates) are stored as `date`** in operational timezone context.

### 20.3 Canonical intake field contract

Unchanged from v1.0 §20.3.

### 20.4 Proposed API commands (changes from v1.0 in **bold**)

| Contract | Intent | Rule |
|---|---|---|
| `POST /api/lead-submissions` | Authenticated server intake | Scoped connection, idempotency |
| Provider-specific webhook routes (`/api/webhooks/meta`, `/api/webhooks/gbp-call`, `/api/webhooks/razorpay`, `/api/webhooks/whatsapp/:provider`) | Verify and durably receive | Provider auth, no employee session |
| `POST /api/lead-imports` + dry-run | Validate + commit upload | Role checks, per-row results |
| `POST /api/leads` | Employee entry | Separate direction / entryMethod |
| **`GET /api/bid-pool`** | List currently claimable leads for the caller | Pool + eligibility filter |
| **`POST /api/bid-pool/:leadId/claim`** | Atomic claim | 409 on race; writes activity, audit |
| **`POST /api/bid-pool/:leadId/pass`** | Personal pass | Reason enum, cooling period |
| `POST /api/leads/:id/reassign` | Reassign ownership | **Super Admin + Sales HOD only**; reason, transfer plan, optional sourcing-credit transfer |
| `POST /api/leads/:id/convert` | Qualified → deal | Authority, unique conversion, expectedVersion |
| `POST /api/activities` + result | Schedule + complete work | Scoped parent, valid assignee |
| `GET /api/sales/work` | Role-specific work queue | Source references and field restrictions |
| `POST /api/deals/:id/stage` | Progress | Never writes approval/payment/outcome |
| `POST /api/deals/:id/commercial-versions` | New offer | Server totals, authority re-eval |
| `POST /api/proposals/:id/publish` | Freeze approved version | Check latest approved |
| `POST /api/approvals/:id/decision` | Independent version-bound decision | No self-approval; stale version conflict |
| `POST /api/receipts/:id/verify` | Confirm receipt | Separate payment permission |
| `POST /api/deals/:id/close-won` | Official win | All prereqs in one transaction; **triggers target achievement writes** |
| `POST /api/briefs/:id/submit` or review | Handoff | Assigned reviewer, project idempotency |
| Public proposal token routes | View / respond | Scoped, expiry, rate limit |
| **`POST /api/targets`** | Create target assignment | Authority check; no self-assignment |
| **`PATCH /api/targets/:id`** | Edit (void, notes); amount edit creates new version | Optimistic concurrency |
| **`POST /api/targets/:id/extend`** | Extend period end | Super Admin only; reason mandatory |
| **`POST /api/targets/:id/void`** | Void target | Super Admin only |
| **`GET /api/targets/*`** | Various reads | Scope-filtered |

All commands accept an idempotency key for consequential creation / side effects, and `expectedVersion` for concurrent editing. Return structured validation, permission, stale-version and dependency errors.

---

## Section 21 — Reliability, security, privacy, accessibility [v1.1 — dual-clock formalised]

### 21.1 Service objectives

Testable planning assumptions. Measure before promising:
- Up to 100 concurrent users per tenant
- 100 000 leads per tenant
- 10 000 imported rows per job
- 50 intake events / second burst with async processing
- Target writes complete within 60 seconds of `deal.won`

**R-NFR-01 P0.** Lead lists and detail APIs p95 < 1 s under pilot load; My Work p95 < 2 s; provider receipt ACK < 2 s when storage healthy. Heavy exports / imports / document generation run as jobs with progress.

**R-NFR-02 P0.** Monthly intake and core-service availability 99.9 percent (excluding provider outages). RTO 4 h, RPO 15 min.

**R-NFR-03 P0.** Index tenant/source/owner/state/date and external keys. Paginate timelines. Job leases + heartbeat + restart recovery. No open transactions during provider network calls.

### 21.2 Security

**R-SEC-01 P0.** Provider credentials in approved encrypted secret store, redacted in logs, rotatable. Raw-body signature validation on all webhooks. TLS, rate limits, size limits, attachment scanning, least-privilege service identities.

**R-SEC-02 P0.** Absolute tenant boundaries before business scope. Public proposal tokens grant only their document. Protect downloads, bulk jobs, reports, caches, real-time subscriptions.

**R-SEC-03 P0.** Activity history append-oriented. Audit events: actor/service, organization, command, affected object, change summary, time, correlation ID. **Target achievement writes are audited.** Target assignment, edit, extend and void are audited.

### 21.3 Privacy

**R-PRIV-01 P0.** Document per source what was collected, why stored, permitted channels, notice evidence, retention. Lead receipt is not blanket marketing consent. Configure suppression, data-access review and deletion workflows.

**R-PRIV-02 P1.** Marketing re-engagement defaults to aggregates. Segment cells below 10 contacts suppressed unless explicitly authorized.

### 21.4 Accessibility

**R-ACCY-01 P0.** WCAG 2.2 AA target in actual flows. Keyboard, contrast, accessible errors, descriptive buttons, focus restoration, text alternatives for status and charts.

### 21.5 Dual-clock timezone model [v1.1 — new]

**R-TZ-01 P0.** The **operational timezone** is `Asia/Kolkata` (L7), fixed at the tenant level. All of the following use the operational timezone:
- Business-hour calculations
- SLA clocks (first-attempt, bid-pool timeout, approval SLA)
- Reminder due times for internal staff
- Shift and attendance comparisons
- Reporting date buckets (daily, weekly, monthly)
- Target period boundaries

**R-TZ-02 P0.** The **customer timezone** is derived per Contact in this order of precedence:
1. Explicit value entered on the submission form or by an agent
2. Country code of the primary phone (`+91` → IST, `+1` → spans US/Canada → fall through)
3. IP geolocation at submission time (if captured and permitted)
4. Fallback to `Asia/Kolkata`

The derived value is stored on the Contact as `preferredTimezone`.

**R-TZ-03 P0.** The customer timezone is used for:
- Quiet-hours check before sending WhatsApp, email, SMS to the customer
- "Best time to call" display on the contact detail
- Customer-facing scheduling (demos, callbacks offered to the customer in their timezone)

**R-TZ-04 P0.** Where the two clocks disagree (e.g., a quiet-hours block in Dubai means Sahil in Delhi can't message right now), the quiet-hours block wins for customer-facing actions; internal reminders continue to fire in operational time.

**R-TZ-05 P1.** Agents can override the per-contact timezone from the contact detail view. Overrides are audited.

**R-TZ-06 P0.** The pilot ships with Asia/Kolkata on both clocks for simplicity. Per-contact derivation is implemented but defaults to `Asia/Kolkata` until the first non-India phone or form entry triggers a different value. No code path hardcodes Asia/Kolkata; the derivation is always run.

### 21.6 Operational monitoring

Monitor intake lag, last successful receipt / retrieval, retries, permission failures, dead letters, queued lead age, **bid-pool pickup latency**, **fallback trigger count**, activity / reminder delay, stalled sweep age, outbox delivery, **target achievement write lag**, document failure, handoff-consumer failure. Metrics per connector and tenant without exposing PII.

---

## Section 22 — Migration and compatibility

**R-MIG-01 P0.** Introduce new fields and tables additively. Backfill in controlled batches. Keep old routes usable while screens migrate.

**R-MIG-02 P0.** Retain original legacy status and migration version. Map statuses per §9. Ambiguous `proposal_sent` and `converted` records enter reconciliation.

**R-MIG-03 P0.** Extend phone normalisation with a migration review queue. Link contact identity only after conflict checks. Preserve existing lead IDs.

**R-MIG-04 P0.** Callback-ownership correction is a reviewed migration (per v1.0 R-MIG-04).

**R-MIG-05 P1.** Add Deals and receipts behind flags. Dry-run qualification conversion. Compare old/new reporting before cutover.

**R-MIG-06 P0.** Rollout flags for: workspace, intake, **bidding pool**, direct routing, conversion, commercial documents, win controls, **target module**. Rollback restores previous UI paths without deleting accepted submissions, commercial evidence, or target history.

**R-MIG-07 P0 [v1.1].** Target backfill is **not** attempted from pre-v1.1 won deals by default. If historical attribution is required, Super Admin runs a bounded backfill job that reconstructs attributions from `originatingAgentId` / `closedById` (or defaults where missing) and writes achievements with `createdBy = 'migration'`. The job is idempotent on `(dealId, userId, reason)`.

---

## Section 23 — Acceptance scenarios

v1.0 tests AT01–AT42 remain. New / updated tests:

| ID | Scenario | Required result |
|---|---|---|
| AT14′ | **Updated:** Two eligible agents claim the same bid-pool lead simultaneously | Exactly one `201 Claimed`, one `409 ALREADY_CLAIMED`; one activity created; one audit row |
| AT43 | External lead arrives with 5 eligible agents in the pool | All 5 see the masked card; viewer count updates; PII hidden |
| AT44 | Agent passes a bid-pool lead, then same lead re-expands into their pool within 5 min | Card is not shown to them (cooling period); shown again after 5 min elapsed |
| AT45 | Bid-pool lead sits 10 min with no claim | Falls back to direct-assignment router; Supervisor alert fires; audit records `mode = fallback` |
| AT46 | HOD reassigns a claimed lead, keeping sourcing credit | `currentHolderId` changes; `originatingAgentId` unchanged; previous holder notified with reason |
| AT47 | HOD reassigns with `transferSourcingCredit = true` on an already-won deal | Compensating target rows: negative for original sourcer, positive for new sourcer; both audited |
| AT48 | Super Admin assigns a target to themselves | Rejected with `AUTH_SELF_ASSIGN` |
| AT49 | HOD attempts to extend a target | Rejected with `AUTH_EXTEND_NOT_ALLOWED` |
| AT50 | Deal wins; sourcer == closer | Single achievement row at 100% share |
| AT51 | Deal wins; sourcer ≠ closer | Two achievement rows at 60 / 40 split; both visible on respective My Target views |
| AT52 | Deal in USD wins against an INR monthly target | Achievement stored in INR with frozen rate on `wonAt`; rate source recorded |
| AT53 | FX rate missing for cross-currency win | Achievement write fails; admin alert; deal state unchanged |
| AT54 | Deal refunded in current period | Negative achievement row booked at refund date; running total reduces |
| AT55 | Deal refunded 1 period later | Negative row booked in current period (not retroactive to prior period); prior period's historical close total unchanged |
| AT56 | Super Admin extends monthly target by 10 days; deal wins on day 35 | Deal credits this (extended) target; UI shows "Extended by 10 days (reason: …)" |
| AT57 | Mail arrives from a known contact's address | Appended to that contact's existing lead/deal timeline; no new lead |
| AT58 | WhatsApp message from unknown number classified as sales enquiry | New lead enters bid pool with `source = whatsapp` |
| AT59 | GBP call forwards through Exotel, caller answered by Rahul Shah | Lead created with `source = gbp`, `direction = inbound`; call activity records Rahul Shah as handler; `originatingAgentId = Rahul Shah` |
| AT60 | GBP missed call | Lead created, enters bid pool as "missed call — return within 10 bm"; first callback within SLA |
| AT61 | Customer in Dubai; agent in Delhi tries to send WhatsApp at 23:30 IST (= 22:00 Dubai, quiet hours in configured policy) | Send blocked / queued until Dubai 09:00; internal reminder still fires at 23:30 IST |
| AT62 | Agent moves teams on Oct 20; team roll-up for Oct | Agent's wins pre-Oct 20 counted in old team; post-Oct 20 counted in new team |
| AT63 | Multi-tenant: tenant B guesses tenant A's targetId | 404 (not 403) — no existence disclosure across tenants |

**Release checklist.** Field-policy API tests, concurrent command tests (bid-pool claim, deal.won + target write, reassignment during win race), provider sandbox tests (Meta, WhatsApp provider, Razorpay, Exotel), migration rehearsal, restore drill, keyboard/mobile walkthrough, Sales/Finance/Delivery UAT, **target reconciliation UAT**. Assign a named reviewer per result. No severe access, financial-integrity or enquiry-loss defect may remain open at release.

---

## Section 24 — Delivery order and remaining decisions [v1.1]

### 24.1 Implementation increments

| Increment | Scope | Dependency and exit |
|---|---|---|
| **R0** Foundation and corrections | Canonical identity/intake contract, ownership fixes, availability facade, policy registry, **operational-vs-customer timezone split** | Resolve authority model, L1 source accounts, clocks; baseline audited |
| **R1** Reliable lead operations with bidding | Manual entry, website intake, Meta adapter, email adapter, WhatsApp adapter, GBP-call adapter, dedupe, **bidding pool + fallback router**, My Work, activities, triage queue | AT14′, AT43–AT45, AT57–AT60 pass; no lost acknowledged enquiry |
| **R2** Qualified opportunities | Conversion command, Deal module, five-state detail, board, cross-team policy, reassignment with sourcing-credit preservation | AT19, AT46, AT47 pass; one deal per conversion |
| **R3** Commercial agreement | Versioned proposals / quotes, customer responses, approvals, contracts | Current-version authority tests pass |
| **R4** Paid sale, delivery, **targets** | Receipts, Finance facade, Razorpay adapter, official wins, brief review, project linking, **TargetAssignment + TargetAchievement + TargetAuditEvent + target UIs** | AT50–AT56, AT62 pass; verified advance → owned brief end-to-end; target reconciliation ≤ 60 s |
| **R5** Management and improvement | Forecast / targets reporting layer, customer view, renewals, sequences, scoring, bulk reassignment, advanced fairness guards, fairness report | Metrics reconcile; automation respects contact rules |

R0 → R4 constitutes the operational baseline. R1 enables a limited pilot but not the full sales system. Estimate effort only after provider access and remaining platform gaps are verified.

### 24.2 Remaining open decisions (unresolved)

| ID | Decision | Recommended default | Owner |
|---|---|---|---|
| O1 | WhatsApp provider | Interakt for Indian SMEs (template approval support, local pricing) | Business + engineering |
| O2 | GBP call-tracking provider | Exotel | Sales ops |
| O3 | Fairness caps (daily claim cap, active-lead cap) | No daily cap; 20 active leads; 5-min pass cooling | Sales HOD |
| O4 | Initial Super Admin and Sales HOD seats | At least 2 Super Admins (so no self-assignment deadlocks); 1 Sales HOD per department | Business leadership |
| O5 | Approval ladder | Agent 5%, Supervisor 10%, Team Lead 15%, Sales HOD > 15% | Sales HOD + Finance |
| O6 | Payment gateway | Razorpay | Business leadership |
| O-FX | FX rate source | Manual admin rate table in pilot; move to API provider post-pilot | Finance |

### 24.3 Decisions already locked (reference)

See the "Recorded locks" table in §0.

---

## Section 25 — Traceability to the uploaded project

Unchanged from v1.0 §25. v1.1 additions trace to:

| Evidence label | v1.1 note |
|---|---|
| E5 Routing | Replaced as primary strategy by bidding pool; direct router retained as fallback |
| E6 Handover eligibility | Unchanged (handover is distinct from bidding) |
| E11 Financial boundary | Target achievement write integrates alongside receipt / posting intent |
| **E13 Target module** | **New in v1.1; no prior evidence; green-field implementation** |

---

## Section 26 — Research references

Unchanged from v1.0 §26. Primary references used by v1.1 provider work:

- R1 Meta Lead Ads webhook sample
- R2 Google Ads Lead Form Webhook (reference only; adapter deferred)
- R7 WhatsApp provider documentation (Twilio example; actual provider = O1)
- R8 Razorpay webhook validation

Additional references for v1.1:

- Google Business Profile call-click tracking documentation (Exotel standard India pattern)
- RBI reference rates (fallback FX source where applicable)

---

## Appendix A — Decision cross-reference

Quick index of locked decisions (L1–L14) and open decisions (O1–O7) referenced across the document.

**Locks:** §0 Table 2 (change-log preamble) is authoritative.
**Open:** §24.2 is authoritative.

If a section refers to a lock or open ID without matching the above, it is a drafting error — report to the PRD maintainer.

---

## Appendix B — Pre-pilot checklist

Required from the client before engineering can start R0:

- [ ] Meta Business Manager admin access + ad account `leads_retrieval` scope + list of forms
- [ ] Website form inventory + agreement on server-to-server POST (client dev team or ours)
- [ ] WhatsApp provider decision (O1); WABA ID; verified business number; template drafts
- [ ] Business mailbox(es) + Workspace/M365 admin consent on folder scope
- [ ] GBP listing control; Exotel account (O2) and tracked number
- [ ] Razorpay account access (O6) with webhook secret
- [ ] Sales organisation chart with named Super Admins (≥ 2), Sales HOD(s), Team Leads, Agents
- [ ] Approval ladder confirmed (O5)
- [ ] Service / product catalogue
- [ ] Territory definitions (cities / states / services)
- [ ] Loss reasons list
- [ ] Qualification criteria (minimum budget, decision-maker, timing)
- [ ] Target period start conventions (fiscal month? Mon-start weeks?)
- [ ] Target attribution split confirmed (default 60/40)
- [ ] Signed DPA
- [ ] Privacy policy covering lead capture + CRM storage + call recording
- [ ] Fairness caps confirmed (O3)
- [ ] Historical lead data export (CSV, for import rehearsal)
- [ ] Hosting arrangement, domain, SSL, email-sending DNS records

---

End of PRD v1.1.
