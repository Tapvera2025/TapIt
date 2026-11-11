# Remaining Sales flow QA — 31 October 2026

**Status: testing found two confirmed product blockers. The complete Sales flow remains a partial pass.** Callback rescheduling and public change requests now pass in Chrome. Mark Lost and cancel-after-win fail through their normal authenticated browser routes.

This follows the [four-fix regression retest](sales-fix-retest-2026-10-31.md). Historical states in that report are superseded by the retained states below where explicitly noted.

## Runtime and method

- Real Chrome UI at `http://localhost:5173`, using native accessibility controls and screenshots. Existing approved QA Alpha/Beta accounts and Isolated QA Organization Admin were used.
- Rebuilt/recreated migrate/server/client after detecting older files in the running images. TypeScript builds passed, migrations completed, and server became healthy. SHA-256 checks matched the checkout and containers for the newer callback, public-response, and deal-service files.
- Browser/public-response testing began around 03:09 IST and resumed around 12:22 IST after Chrome/window and session recovery. The isolated admin signed in with its existing temporary QA credential. No credential was reset, no browser password-save action was taken, and no new account or permission was created.
- All lead/deal, callback, proposal response, synthetic receipt, brief, win, and cancellation attempts described as browser checks were performed in Chrome. Read-only PostgreSQL and narrow server-log checks corroborate outcomes.
- Existing PostgreSQL integration suites ran separately using their own throwaway test organizations and fixture users. Those results do not establish browser journeys or real provider execution.
- No real services, contracts, payments, refunds, provider messages, or customer communication occurred. #259's proposal/scope explicitly excludes real obligations. Receipt reference `QA-SIMULATED-NO-FUNDS-R4-CANCEL` is an internal synthetic test entry; **no funds moved**.

## Confirmed browser passes

| Scenario | Result / evidence |
| --- | --- |
| Public empty change request | PASS. Request changes with no comment displayed the local required-comment message. |
| Public nonempty change request | PASS. On #259 v1, a synthetic note submitted and displayed “Thanks — we received your note and will respond shortly.” The comment property now agrees with the server contract. Submission does not mean an issuer-facing conversation workflow exists; see limits. |
| Callback schedule / reschedule | PASS. Alpha scheduled #113 for **1 November 2026 10:30 Asia/Kolkata**. Reschedule +1h produced **11:30 on the same date**, marking the original Rescheduled and replacement Pending. Persisted instants differ by exactly one hour. This closes reproduced R2-01. |
| Callback cancellation | PASS. Alpha cancelled the replacement; it displayed Cancelled and mutation controls disappeared. The original remains Rescheduled. Lead status still reads Callback Scheduled with no pending callback; that earlier lifecycle presentation issue remains open. |
| Agent manual lead → conversion | PASS. Alpha created #152 with synthetic identity/scope and converted it normally to #342 without SQL contact assistance. Owner/closer/source context rendered. |
| Public acceptance after question | PASS. The same explicitly nonbinding #259 v1 accepted in Chrome at **12:25:29 IST**. The admin proposal page displayed v1 Accepted. |
| Simulated expected advance | PASS. INR60000 with the explicit no-funds reference saved on #259. Payment became Advance confirmed; missing brief remained a close blocker. |
| Delivery brief draft/autosave/submit | PASS. Created #259's brief from accepted v1, filled synthetic contacts/scope/deliverables/exclusions/payment/notes, observed Saved, then Submitted at **12:26:20 IST**. Fields became disabled. |
| Additional official win | PASS. With accepted commercials, simulated advance and submitted brief, #259 showed All close conditions met. Record win produced Closed Won / 100% at **12:26:27 IST**. |
| Reporting after additional win | PASS. October admin report displayed Won 2 / Lost 1 / Open 1, won INR218000, Cancelled 0; closer leaderboard showed 2 wins / INR218000. This matches #257 plus #259 and the denied cancellation. |
| Wins-to-record exclusion | PASS. Queue showed older open #256 and excluded the two won deals. No additional win was recorded on #256. |
| Brief cancellation after win | PASS. On #259's submitted brief, admin supplied a synthetic cancellation reason. Brief became Cancelled, read-only, reviewed at **12:27:31 IST**. Deal remains Won; this is brief cancellation, not successful deal cancellation. |
| Expired queue offer | PASS, browser disappearance + DB corroboration. Alpha's refreshed Handovers no longer offered the earlier #116 unclaimed queue item. PostgreSQL confirmed it Expired, accepted_at null. |
| Unrelated-deal visibility | PASS. In Beta's browser session, direct access to Alpha's #342 showed outside this principal's own scope; no deal fields were shown. |
| Cross-tenant proposal visibility | PASS. Beta opened isolated-tenant #259's proposal route and saw deal not found, with no proposal content. |
| Proposal revision after win | PASS at server gate. On won #259, admin clicked New draft from latest; the page returned “Deal lifecycle is already terminal; publish is not permitted.” No new version was displayed. The button remains offered before this rejection. |

Read-only audit verification also confirmed #259's synthetic public question was drained successfully (one attempt, no last_error) and persisted as a commercials.question audit entry with the entered comment.

### Further live revision / approval checks

On still-open #256, admin created v3 from published v2, added explicitly synthetic custom terms, and attempted publication. The server refused publication and exposed Request approval. Submission succeeded; #256 appeared Pending in Approvals and its Record win control became disabled by the pending-approval condition.

Admin then changed v3's unit price from INR100000 to INR110000 for quantity 2. Autosave produced subtotal INR220000, tax INR39600, total **INR259600**, expected advance INR60000. The previous approval became **invalidated / commercials_changed** in PostgreSQL. Refreshing the live Approvals page showed only the old #258 request; the invalidated #256 item was gone. This passes material-revision invalidation and queue cleanup for that path. It does not repair the separate Mark Lost SQL failure.

Final #256 state: open / advance_confirmed / approval_not_required, v2 still Published and v3 **Draft**. The new draft was not approved or published. The failed won-deal draft attempt left #259 with exactly one commercials version. [Final revision state](sales-qa-2026-10-31/remaining-flow-final-state.json) records these checks.

## R4-01 — Critical: Mark Lost now returns an internal error

Alpha created a fresh synthetic lead #152 and deal #342. From its detail page, selected Mark lost, kept Other, entered the explicit QA note, and submitted. The modal did not close; dismissing it exposed **Internal error**. Deal remained Discovery / Open / Unpaid.

Server evidence:

- `POST /api/deals/:id/lost` → **HTTP500 INTERNAL_ERROR**.
- Request ID `62182f2d-9b6c-4e25-bc63-c9204483132a`.
- Database error: `column "decision_note" does not exist`.
- Current `approval_request` schema has `blocked_reason`, `decided_at`, `decided_by`, and `updated_at`, but no `decision_note`.
- `deals/service.ts`'s new Mark Lost cleanup references that nonexistent column. PostgreSQL rejects the query even when the deal has no pending approvals, and rolls back the loss transaction.
- Both existing Mark Lost integration assertions reproduce the same error. #342's persisted lifecycle is open and lost_at is null.

The cleanup therefore does not pass. The earlier #258 lost deal also remains approval_pending in storage and still appears Pending in Approvals. No historical cleanup/backfill was observed.

Repair direction: use the actual approval schema and audit semantics for invalidation; verify Mark Lost both with and without pending requests, transaction rollback, and how pre-existing lost/pending requests are resolved. Source: `packages/server/src/modules/sales/deals/service.ts`, `migrations/0084_sales_approvals.sql`.

## R4-02 — Critical: cancel-after-win lacks its required initiator field

After recording synthetic #259 Won, admin opened Cancel after win, entered the explicit QA-only reason, and clicked Cancel deal. Dismissing the still-open modal exposed:

`deals:approve: declared initiator field "createdBy" is absent from deal:01a18eb9-ba7b-7785-8080-0301b11467ac. Denying rather than passing (SD-B).`

- `POST /api/deals/:id/cancel-after-win` → **HTTP403 FORBIDDEN**.
- Request ID `94ed9774-c51f-44dc-90be-6e5cd9b68f2a`.
- Route action is `deals:approve`, whose registry initiator is `createdBy`. The deal resource loader supplies closer/originator, closedBy, and payment initiator, but omits createdBy.
- This fails before a meaningful same-initiator/independent-approver decision. Do not count it as a successful expected self-approval denial.
- Persisted #259 remains won / advance_confirmed, cancelled_at null.

Repair direction: align the route/resource with the intended cancellation initiator and preserve independent authorization semantics. Test the normal authenticated route; a direct service integration call bypasses this framework guard. Source: `deals/routes.ts`, `deals/repository.ts`, and `packages/contracts/src/registry.generated.ts`.

## Remaining setup and coverage limits

- #259's acceptance modal offered a project picker, but it had No projects found and Accept disabled. The isolated tenant still has zero clients and projects. Project association/idempotency remains untested. The earlier new-client credential handoff has not been bypassed.
- Independent approval/reversal, administrative reassignment, and on-duty direct handover still lack suitable usable QA setup in the browser. No attendance rows were fabricated for the approved persistent QA accounts.
- Bid Pool rendered its empty state; no populated competing claim was exercised in Chrome. The separate isolated PostgreSQL competing-claim test passed.
- Real provider intake, outbound notifications, import UI, targets/renewals, contract-provider signing, refund execution, successful independent reversal, and successful deal cancellation remain unverified browser/provider journeys.
- The public question endpoint records an audit event; the success message alone does not verify issuer notification or an operational response inbox.
- Mark Lost and cancel-after-win errors remained outside their open modals. The earlier error-in-modal fix covered the two payment dialogs, not these dialogs.

## PostgreSQL integration results — distinct from browser coverage

| Suite | Latest result | Coverage |
| --- | --- | --- |
| Approvals | 11 passed | Independent decision, self-approval/wrong-reviewer refusal, escalation, material-revision invalidation |
| Contracts | 6 passed | Draft/sent/signed state, amendment, active-contract and publication guards; synthetic service fixtures only |
| Won recorder | 6 passed | Readiness, record-win permission, repeated-win rejection, queue semantics |
| Public portal | 10 passed | Token expiry/revocation/supersession, acceptance replay, rate limits |
| Deals service | 7 passed / 2 failed | Both failures are Mark Lost's nonexistent decision_note column |
| Bidding | 7 passed after fixture correction | Concurrent claim has one winner; pass/cooldown; expiry/fallback; pool visibility |

Latest results across these six suites: **47 passed / 2 failed / 0 skipped**. They were executed in separate initial/focused runs; this is the latest result per suite, not a claim of one final green run. The [integration assertion summary](sales-qa-2026-10-31/remaining-integration-summary.json) preserves the five non-bidding suites and the separate bidding result.

The bidding fixture originally used UTC calendar date for WORKING presence while the service reads Asia/Kolkata work_date. Corrected only that test helper to `localDateOf(now, 'Asia/Kolkata')`; all seven bidding checks then passed. No production implementation was changed during testing. Existing fixture cleanup ran in each integration suite; these fixtures are not usable login accounts or proof of real attendance.

## Retained state

- New #152 `01a190bc-674b-7b17-8d77-7099a1e49ad0`: converted normally through Chrome.
- New #342 `01a190bc-9324-7a74-bf0f-6f8ee5b705e7`: open/unpaid after failed Mark Lost; Alpha responsible closer.
- #259 `01a18eb9-ba7b-7785-8080-0301b11467ac`: **won/advance_confirmed**, simulated INR60000 receipt. Its brief `01a190be-84e6-770e-bfa1-7c40432066e9` is **cancelled**, project_id null. Cancellation of the deal did not succeed.
- #257 remains won. #258 remains lost/approval_pending. #256 remains open with its earlier simulated advance, published v2 and revised draft v3; the v3 approval was invalidated by its material revision.
- #113 original callback `01a190bb-a51d-71a0-b5ac-34ec71e61955`: rescheduled, 1 November 10:30 IST. Child `01a190bb-b2d6-7d6b-92ad-59487a67d3a7`: cancelled, 1 November 11:30 IST.

No password, session token, proposal bearer token, or real customer data belongs in this evidence. The [remaining-flow state](sales-qa-2026-10-31/remaining-flow-state.json) records selected synthetic state and regression outcomes.
