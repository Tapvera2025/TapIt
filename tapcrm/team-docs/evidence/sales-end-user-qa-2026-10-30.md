# Sales end-user QA — 30 October 2026

> Latest continuation: [31 October live browser checks](sales-end-user-continuation-2026-10-31.md), including additional callback/handover outcomes, advance validation, and retained synthetic-record state.

> **Historical run.** A fresh live-Chrome retest after the fixes is recorded in [Sales browser retest — 30 October 2026](sales-end-user-retest-2026-10-30.md). That run successfully created a new lead, converted it without a contact workaround, accepted/published a proposal, confirmed a simulated advance, and recorded Closed Won. It also verified a queued transfer and found remaining callback/change-request/queue issues. Read the retest for current coverage and limitations; the results below describe the earlier runtime.

**Result: the complete sales journey did not pass.** Territory/team setup and parts of proposals/delivery work, but ordinary lead capture cannot progress reliably through assignment, callbacks, conversion, approval, customer acceptance, and close.

## Environment and method

- Local UI: `http://localhost:5173`; API: `http://127.0.0.1:4000`.
- Organization: **Tapvera Complete Workspace**, code `TAPMVT9H8DP`, ID `01a186b3-f39a-7c42-9199-d8b1e9a739ed`.
- Repository HEAD: `ec6ee13`, with pre-existing local changes. Runtime client/server are Docker images; this is a report of the running app, not a claim that every checkout change is deployed.
- Browser: real Chrome UI, using accessibility controls. Initial identity: **Tapvera Organization Admin**. Later identity: **QA Sales Agent Alpha 2026-10-30**.
- Additional evidence: authenticated HTTP checks with both QA agents, read-only PostgreSQL inspection, API error logs, and targeted source inspection.
- No fixes, migrations, container rebuilds, or changes to `.env` were performed. No actual money movement, customer messages, contract signature, or provider calls were performed.

### Fixture boundaries

The team, pool, territory, outbound source, three leads, deal, proposal, and delivery-brief actions below were performed through the UI unless stated otherwise.

The user explicitly approved two synthetic Sales accounts. The onboarding wizard was attempted, but its required shift and weekday lists were empty. The two accounts were therefore inserted as isolated local test fixtures with normal Sales Agent position, the QA pool, and the existing Sales Head as manager. This **does not count as successful UI employee onboarding**, and no attendance/punch state was fabricated.

After manual lead conversion failed because the lead lacked a contact, a synthetic contact was linked **only to QA Beta** through fixture SQL. This allowed independent proposal and delivery testing. The original conversion failure remains a failure; later successes do not establish an uninterrupted end-to-end journey.

The original admin session expired during the run. Subsequent user-assisted sign-in could not be observed in the controlled tabs. A separate QA-agent UI login succeeded. Remaining admin-only actions must be reported separately from tested results.

### Approved admin-access follow-up

The user explicitly approved checking whether the existing `DEMO_EMPLOYEE_PASSWORD` matched the local organization admin and using it for local API login without displaying or saving the password/hash. The check ran at 15:22 IST on 30 October 2026 and returned **no match**. Consequently, no admin API login or payment/win mutation was attempted. No credential was changed. The controlled admin tab still showed `/login`; the working browser session was QA Sales Agent Alpha. A direct organization-admin sign-in is needed to continue these remaining tests.

The user subsequently supplied `http://localhost:5173/company/sales/my-work`. The exact active Chrome page was inspected and its account header identified **QA Sales Agent Alpha 2026-10-30**. This resolved the browser-state ambiguity: that supplied page is a working agent session, and does not provide the admin authority required for the remaining payment/win checks.

### Isolated admin follow-up — access blocker resolved

The user explicitly approved a separate local QA organization and test Super Admin. The supported `tools/provision-tenant.ts` workflow created organization **QASALESMVUTWNQI**, ID `01a18c5a-2684-768a-88d8-b9db91e72325`, with admin **Isolated QA Organization Admin** (`qa.sales.admin.mvutwnqi@example.test`). No access was added to the original organization.

Admin login and identity verification succeeded. A synthetic outbound lead (#114) reproduced the missing-contact conversion failure. An explicitly labeled contact fixture then allowed a separate deal (#256), proposal, and draft brief to be created for downstream tests. These fixture-dependent steps still do not count as a normal capture-to-close pass.

The authenticated API run performed 21 checks. Valid advance confirmation, attempted reversal, and record-win requests all failed with HTTP 403 because the loaded deal resource omits the required initiator fields. This is a product blocker, independently of the earlier unavailable login.

The follow-up was also performed **live in Chrome** as the isolated admin:

- Opened deal #256, filled the advance form with ₹50,000 and the reference `QA-SIMULATED-NO-FUNDS-20261030-LIVE`, and clicked Confirm. The UI showed the missing `payment.initiatedBy` error behind the modal. Closing the modal exposed the full error. Payment stayed Unpaid and Record win stayed disabled.
- Opened Approvals and Wins to record; both reproduced the authorization errors in the browser.
- Opened lead #114 and scheduled a synthetic callback for 31 October 2026 at 15:00 Asia/Kolkata. It failed with the generic validation message.
- Changed deal #256 from Discovery to Proposal; probability changed from 10% to 25%.
- Created proposal v2 from v1 in the UI, changed quantity to 2 and expected advance to ₹60,000, verified autosave and totals (₹200,000 + ₹36,000 tax = ₹236,000), and published v2. Published fields became disabled.
- Opened the public v2 link in a separate tab. Correct revised amounts rendered, but title/version number and customer-response controls were missing.
- Regenerated the share link, reloaded the old public link, and verified “Proposal unavailable — Proposal link is no longer available (revoked).” Opened the replacement link and verified it displayed the revised proposal.

Final read-only API verification confirmed #256 is **proposal/open/unpaid**, v2 is **published**, v1 is **superseded**, the brief is **draft**, and `canClose=false` with the payment condition unmet. No successful payment recording, official win, or completed end-to-end sale is claimed.

## Coverage

| Scenario | Result | Evidence / limitation |
|---|---|---|
| Create root Sales team | PASS, UI | QA team persisted in organization directory |
| Create child Sales pool | PASS, UI | Correct parent Sales team persisted |
| Create territory and select team | PASS, UI | Territory detail showed correct team and child pool |
| Territory coverage count | FAIL, UI | Immediately after save, list still showed “0 configured” while the territory existed; persistence after reload was not assessed |
| Employee onboarding | BLOCKED, UI | Required shift and weekday-schedule dropdowns contained no choices |
| Create two QA agents in pool | SETUP ONLY, SQL | Explicitly approved fixtures, not an end-user onboarding pass |
| Capture inbound lead | PARTIAL, UI | Lead #111 persisted and matched territory; unowned, no pool/contact link |
| Capture outbound lead as admin | PARTIAL, UI | Lead #112 persisted with admin as holder; no contact/team/pool linkage |
| Capture outbound lead as agent | PARTIAL, UI | Lead #113 persisted with Alpha as holder; no contact/team/pool linkage |
| Requirement/location/language/notes retention | FAIL, source corroboration | Entered in UI, but omitted from create payload and absent from server create contract |
| Assign/reassign to QA agents | FAIL, UI | Admin dropdown still empty after both Sales Agents existed |
| Agent transfers own lead to Beta | EXPECTED DENIAL, API | HTTP 403: wider than own/participant scope required |
| Schedule callback for unrouted lead | EXPECTED DENIAL, UI | “An unrouted lead cannot have a callback”; UI allowed submitting the doomed request |
| Schedule callback for owned lead | FAIL, UI + API + DB | HTTP 422; status default conflicts with check constraint |
| Callback complete/reschedule/missed/cancel | BLOCKED | No callback could be created normally |
| Direct live-call handover | BLOCKED | No eligible receiver; source hardcodes every receiver unselectable |
| Agent queues outbound lead for Sales team | FAIL, UI | “This Lead cannot be placed into a Sales team queue” |
| Convert normal manual lead to deal | FAIL, UI | `DEAL_CONTACT_UNRESOLVED` |
| Convert QA Beta after contact fixture | PASS WITH FIXTURE, UI | Created deal #255; not a normal-flow pass |
| Source lead becomes converted | FAIL, DB | QA Beta remained `status=assigned`, `lead_outcome=active` after deal creation |
| Proposal draft/autosave/calculations | PASS WITH FIXTURE, UI | ₹100,000 + ₹18,000 tax = ₹118,000; ₹50,000 expected advance |
| Publish with custom terms | BLOCKED, UI | HTTP 409 requires approval; no request-approval action in editor |
| Publish without custom terms | PASS WITH FIXTURE, UI | v1 published, fields disabled, share link generated |
| Customer public proposal | PARTIAL, UI | Pricing/scope rendered; title/version missing, no acceptance/rejection/change controls |
| Admin approvals queue | FAIL, UI + logs | HTTP 403 even for organization admin |
| Admin wins-to-record queue | FAIL, UI + logs | HTTP 403 even for organization admin |
| Deal stage Discovery → Proposal | PASS WITH FIXTURE, UI | Stage changed and probability changed from 10% to 25% |
| Start/edit/submit delivery brief | PASS WITH FIXTURE, UI | Published v1 selected; fields saved and brief submitted |
| Request changes/revise/resubmit brief | PASS WITH FIXTURE, UI | Feedback displayed, fields reopened, revised brief resubmitted |
| Accept brief / project handoff | BLOCKED, UI | Requires a pre-created project's raw UUID; no selector or automatic creation |
| Initial win-readiness UI | PARTIAL, UI | Record win disabled for missing payment and delivery brief; before publication also flagged commercials |
| Advance recording / official win | FAIL, isolated admin API + live UI | Confirmation and reversal return 403 for missing `payment.initiatedBy`; win request returns 403 for missing `closedBy`; live Record win remains disabled |
| Advance amount validation / payment replay | BLOCKED | Zero and below-advance requests fail authorization before business validation; successful replay could not be exercised |
| Proposal revision / v2 publishing | PASS WITH FIXTURE, live UI | v2 saved and published at ₹236,000 total with ₹60,000 expected advance; v1 superseded on persisted record |
| Share-link regeneration / revocation | PASS, live UI | Old link becomes unavailable after reload; replacement link displays v2 |
| Approved configured admin credential check | NO MATCH | Existing demo password did not match this organization admin; no login, reset, or payment/win request followed |
| Agent Reports / forecast | PASS, UI + API, empty data | Report rendered scoped zero totals; forecast HTTP 200 for both agents |
| Agent My Work queue | PASS, UI | Newly assigned count 1 and lead #113 displayed; opened by direct route |
| Bid Pool page | PASS, UI, empty state only | Direct route loads; no live lead available to claim/pass |
| Agent Handovers/Stalled/Re-engagement | PASS, UI, empty state only | Loaded; no populated downstream transitions verified |
| Agent cannot read unrelated admin lead/deal | PASS, API | Both requests HTTP 403 outside own scope |
| Agent territory configuration denial | PASS, API | HTTP 403, no territories:view policy |
| Triage list route | PASS, API, empty state only | HTTP 200; no shadowed-route error |
| External acquisition, import, competing claims | NOT EXECUTED | No provider intake/import or eligible populated bid pool exercised |
| Contracts, refunds, targets, renewal, project creation | NOT EXECUTED | Not established by this run; complete workflow remains blocked upstream |

## Findings and reproduction

### S01 — Critical: new callbacks cannot be inserted

1. Open owned QA lead #112 (admin) or #113 (Alpha).
2. Enter a future callback time and reason, then schedule.
3. UI returns generic validation text. API returns HTTP 422 `NOT_ELIGIBLE`.

API log: `new row for relation "lead_callback" violates check constraint "lead_callback_status_check"` (request `74b35a12-93d7-4d37-92e2-47f5f34aa0b3`).

Read-only DB inspection confirmed `status` defaults to `'scheduled'::text`, while the check permits `pending`, `completed`, `rescheduled`, `not_reachable`, `missed`, `cancelled`. Migration 0059 replaced the check and existing values but did not replace the old default. The repository insert omits `status`, so the invalid default is used.

Source: `migrations/0057_sales_lead_lifecycle_callbacks.sql:20`, `migrations/0059_sales_callback_core.sql:3`, `packages/server/src/modules/sales/leads/callback-repository.ts:15`.

Repair direction: forward migration changing the default, then verify create/reschedule/history/outcomes/reminders against real PostgreSQL.

### S02 — Critical: manual capture creates leads that conversion cannot use

1. Create an outbound lead with name and email.
2. Click Convert to deal and submit a title/service/scope.
3. Receive `Contact could not be resolved — supply contactId or pick an originating lead that has one.`

New manual leads #111 and #113 had `contact_id=null`; #112 did too before the explicit fixture. Manual create inserts legacy contact fields without creating/linking the first-class contact. The UI has no contact picker in conversion.

Source: `packages/server/src/modules/sales/leads/repository.ts:58`, `packages/server/src/modules/sales/deals/service.ts:118`.

Repair direction: use canonical contact/company resolution during manual lead creation and preserve its IDs through conversion.

### S03 — Critical: reassignment dropdown cannot select Sales Agents

1. Create active QA Alpha/Beta Sales Agents in the QA Sales pool.
2. As admin open #111 → Reassign → New owner.
3. The dropdown contains only the placeholder.

The modal calls `getHandoverTargets`. That endpoint selects only Sales Supervisors/Team Leads, excluding Sales Agents. It also hardcodes `availability='not_punched_in'` and `selectable=false`; the client disables unselectable options. Even adding supervisors alone would not make an option selectable with this implementation.

Source: `packages/client/src/company/sales/leads/ReassignModal.tsx:47`, `packages/client/src/company/sales/leads/ReassignModal.tsx:130`, `packages/server/src/modules/sales/handover/repository.ts:44`.

Repair direction: independent assignment candidate endpoint using real eligibility; connect handover availability to actual presence.

### S04 — Critical: approvals and win collection routes fail before listing

Admin Approvals displays `approvals:decide is approval-bearing and requires a resource to check its initiator against.` Wins displays the equivalent message for `deals:record-win`.

Logs confirmed HTTP 403 for `GET /api/approvals/queue` and `GET /api/deals/wins-to-record`. Example request IDs: `e4bc85e0-c270-4067-8899-8361f6a24940`, `d773ebb8-905b-4c4a-bd15-db37dc3a28a8`.

Both screens also show empty-list copy below the failure, potentially suggesting that nothing requires attention.

Source: `packages/server/src/modules/sales/approvals/routes.ts:16`, `packages/server/src/modules/sales/deals/routes.ts:58`.

Repair direction: authorize list access separately from each resource-bearing decision; retain initiator checks on actual decisions and show a clear failed-load state.

### S05 — High: captured enquiry details are silently discarded

Requirement, location, language preference, and notes were filled during capture, but are not sent by the Add Lead drawer. Server create validation also has no such fields. Important sales information appears collected but is not persisted through this path.

Source: `packages/client/src/company/sales/leads/AddLeadDrawer.tsx:127`, `packages/server/src/modules/sales/leads/validators.ts:7`.

### S06 — High: outbound lead has no team/pool context for handover

Alpha belongs to the QA pool, but its outbound lead #113 was saved with null team and pool. Clicking Queue for Sales team returned HTTP 422 `HANDOVER_INVALID`: `This Lead cannot be placed into a Sales team queue` (request `b34f4caf-53f0-45ef-a901-ed0f9b267db0`).

Manual create sets `salesPoolId:null`; outbound routing is skipped and team context is also null. The inbound #111 likewise had no pool despite matching the QA territory/team.

Source: `packages/server/src/modules/sales/leads/service.ts:95`.

### S07 — High: conversion leaves source lead active

After deal #255 was created through the UI, source #112 remained `assigned`/`active`. Deal creation inserts and audits the deal but does not transition the originating lead. This can leave operational work/counts active after conversion. Repeated conversion was not attempted, so duplicate-deal creation is a risk requiring a separate reproduction, not a proven result here.

Source: `packages/server/src/modules/sales/deals/service.ts:125`.

### S08 — High: custom-terms publish has no UI approval resolution

The admin's proposal with nonempty Terms failed to publish with HTTP 409 `COMMERCIALS_PUBLISH_BLOCKED`: `Commercials dimensions exceed authority; request approval before publishing.` The editor has no Request approval control. The publish modal also remains open while the error is rendered behind it; closing it reveals the message.

Clearing Terms (retaining the QA disclaimer in Scope) allowed the same version to publish. The server gate itself was not bypassed or changed.

Source: `packages/server/src/modules/sales/proposals/service.ts:331`, `packages/client/src/company/sales/proposals/ProposalEditorPage.tsx:255`.

### S09 — High: customer cannot complete proposal response from the public UI

The generated public URL loads the correct line item, totals and scope, but the title and version number are blank, and the page has no accept/reject/request-change buttons. The frontend expects `dealTitle`/`version`, which the server card does not return. Customer acceptance was not simulated through an API because that would not prove the end-user flow.

Source: `packages/client/src/company/sales/proposals/PublicProposalPage.tsx:4`, `packages/server/src/modules/sales/proposals/portal/service.ts:144`.

### S10 — Medium: delivery acceptance requires a raw project UUID

Submit → Request changes → revise → resubmit worked. Accept opens “Accept brief and link project” and asks for the UUID of an already-created project. There is no project picker or automatic creation from the brief. Acceptance was not completed; no project association was fabricated.

### S11 — Medium: setup dead ends and stale coverage copy

- Territory creation requires a Sales Team but, when none exist, offers an empty required dropdown without an inline setup path.
- Employee onboarding requires shift and weekday schedules but provides empty selectors and no in-wizard creation path in this organization.
- Territory coverage still said “0 configured” immediately after the first territory was saved, while its detail page correctly displayed the child pool.
- Territory reporting copy calls Leads/Deals “future” modules despite those modules being available in navigation.
- My Work and Bid Pool pages work at `/company/sales/my-work` and `/company/sales/bid-pool`, but the observed agent sidebar provides neither link. My Work does offer an Open bid pool control once reached directly.
- After v2 was published, the version switcher still labeled v1 “Published” in the current editor state. Final API verification showed v1 was correctly superseded in storage, so this is stale UI state rather than a failed supersession write.

### S12 — Critical: individual advance and win actions are denied for Super Admin

The isolated admin reproduced these authenticated route failures on #256:

| Action | Result |
|---|---|
| Confirm ₹50,000 expected advance | HTTP 403: `deals:confirm-payment: declared initiator field "payment.initiatedBy" is absent from deal` |
| Reverse confirmation | Same HTTP 403 before reversal logic |
| Record win | HTTP 403: `deals:record-win: declared initiator field "closedBy" is absent from deal` |

The live payment form reproduced the same missing-field error. The error is rendered behind the open modal, requiring dismissal to read it. This prevents a real Finance/admin receipt-confirmation and close journey through the normal routes. The zero/below-advance probes also hit this guard, so amount-validation behavior was not established by those requests.

Source: `packages/contracts/src/registry.generated.ts:1289`, `packages/contracts/src/registry.generated.ts:1349`, `packages/server/src/modules/sales/deals/repository.ts:191`, `packages/authz/src/sod.ts:51`.

Repair direction: align each resource loader with its action's actual initiator semantics and verify independent-approver behavior. Do not disable segregation-of-duties checks or populate all initiators with null merely to permit the request.

## Machine-readable supporting checks

- `sales-qa-2026-10-30/tapcrm-sales-qa-agent-probes-20261030.json`: two QA identities, login and scoped list/forecast requests.
- `sales-qa-2026-10-30/tapcrm-sales-qa-agent-scope-20261030.json`: own-scope denials, restricted configuration, transfer denial, triage and callback results.
- `sales-qa-2026-10-30/tapcrm-sales-qa-inspect-20261030.json`: read-only persisted QA lead/deal state and invalid callback default.
- `sales-qa-2026-10-30/tapcrm-sales-qa-admin-api-20261030.json`: approved credential-match outcome only; no password, hash, token, or API response data.
- `sales-qa-2026-10-30/tapcrm-sales-isolated-api-20261030.json`: 21 isolated-admin API checks, including confirmation/reversal/win failures.
- `sales-qa-2026-10-30/tapcrm-sales-isolated-final-20261030.json`: final read-only verification after the live browser follow-up.

## Created records and retained state

| Record | Identifier / state |
|---|---|
| QA Sales Team 2026-10-30 | `01a18c10-20df-7d03-a92b-50ba79c5014b` |
| QA Sales Pool 2026-10-30 | `01a18c10-afef-7707-8ce0-cbcd19dc4688` |
| QA Sales 2026-10-30 territory | `01a18c11-0177-782f-8c88-242d2c50f9f8` |
| QA Sales Agent Alpha | `qa.sales.alpha.20261030@tapcrm.local` |
| QA Sales Agent Beta | `qa.sales.beta.20261030@tapcrm.local` |
| QA Outbound 2026-10-30 | Lead source created through UI |
| #111 QA Buyer Alpha | `01a18c11-72b3-7e83-a907-c33745658b61`, unrouted/new |
| #112 QA Buyer Beta | `01a18c13-407a-785b-9213-2ff0e8ccc191`, admin-owned/assigned; synthetic contact fixture linked |
| #113 QA Agent Journey Gamma | `01a18c2f-4fb1-7d61-a84d-2638756e0dde`, Alpha-owned/assigned |
| #255 QA Website Deal Beta | `01a18c1a-03cc-74f7-8697-d8fdc410a994`, proposal/open/unpaid |
| Proposal v1 | Published, ₹118,000 total, expected advance ₹50,000 |
| Delivery brief | Submitted after one revision cycle; final acceptance pending |
| Isolated QA organization | `QASALESMVUTWNQI` / `01a18c5a-2684-768a-88d8-b9db91e72325`; explicitly approved synthetic tenant |
| Isolated QA admin | `qa.sales.admin.mvutwnqi@example.test`; scoped only to the isolated organization |
| #114 Isolated QA Buyer | `01a18c5b-3f00-7374-879e-ecc29385b219`; assigned; synthetic contact fixture linked |
| #256 Isolated QA Closing Journey | `01a18c5b-3f2e-7c08-95e6-c2b80e650147`; proposal/open/unpaid |
| Isolated proposal v2 | `01a18da2-57e6-7a7d-b7e4-44f9cb23bb79`; published; ₹236,000 total / ₹60,000 expected advance |
| Isolated delivery brief | `01a18c5b-3f4a-7775-a476-e57a2d7d26e6`; draft |

Test records remain available for reproduction. No deletions were performed. QA account credentials are kept outside the repository in a mode-0600 temporary file; no password or public proposal bearer token is included in this report.

## Follow-up acceptance gates

1. Repair S01–S04, S05–S09, and S12, then repeat the normal journey without database fixture assistance.
2. Complete manager reassignment between two working QA agents, including callback/activity transfer and retained sourcing credit.
3. Exercise a real eligible bid-pool lead with competing claim attempts, then triage/expiry/recovery.
4. Complete independent commercial approval, customer proposal response, contract requirements, verified advance, official win, and delivery/project handoff.
5. Check source/closer attribution, targets, cancellation/refund reversals, idempotency, and scoped reports against persisted records.
6. Exercise provider intake and notifications in an explicitly configured test environment. Empty list rendering and unit tests are insufficient evidence for these gates.
