# Sales browser retest — 30 October 2026

> Continued in [Sales browser continuation — 31 October 2026](sales-end-user-continuation-2026-10-31.md): callback routing/outcome, queued rejection, reporting after loss, advance validation, and same-initiator reversal denial were checked live. The older synthetic deal #256 now retains an explicitly simulated INR60000 advance; reversal requires an independent authorized principal. Project acceptance remains pending.

**Status: live retest in progress. The fresh capture-to-win path passes; the complete sales module is not yet a clean pass.**

This is a new run against the user's fixes. The [earlier QA report](sales-end-user-qa-2026-10-30.md) records historical failures and is not the result of this retest.

## Runtime and boundaries

- Real Chrome UI controlled through native accessibility controls; local UI `http://localhost:5173`.
- The running source-baked Docker images initially differed from the current checkout. Rebuilt/recreated `migrate`, `server`, and `client` with `docker compose up -d --build migrate server client` before the fresh tests. TypeScript/client builds succeeded; server became healthy. Migration logs confirmed 0123, 0124, and 0125 applied successfully.
- Main fresh journey: approved isolated QA organization `QASALESMVUTWNQI`, ID `01a18c5a-2684-768a-88d8-b9db91e72325`, as Isolated QA Organization Admin.
- Agent transfer journey: existing approved QA Sales Agent Alpha and Beta in `TAPMVT9H8DP`. No real employee was used for the transfer.
- All new team, pool, territory, lead, callback, deal, proposal, customer-response, payment-recording, delivery-brief, approval-request, loss, and handover mutations described below were performed in Chrome. Read-only API diagnostics and source inspection supplement the observed results.
- No source fixes, real payment, external customer communication, real contract, password reset, or fabricated attendance/presence was performed. The fresh proposal/scope explicitly excludes binding obligations and real delivery. The advance is an internal synthetic test receipt labeled `QA-SIMULATED-NO-FUNDS-R2`.
- Existing fixture-assisted lead #114 and deal #256 were not used to claim the fresh journey passed.

## Fresh records

| Record | Identifier / observed state |
| --- | --- |
| Sales team | R2 Sales Team 2026-10-30; `01a18dc0-f539-7572-9cad-e93aa6aaa5b3` |
| Child pool | R2 Sales Pool 2026-10-30; `01a18dc6-32a5-7a7c-93ae-f6d152f90175` |
| Territory | R2 Territory 2026-10-30; active; correct team and pool rendered immediately |
| Main lead | #115 R2 Browser Buyer 2026-10-30; `01a18dc7-df74-715e-aeac-362b8de52e58`; Converted |
| Main deal | #257 R2 Synthetic Buyer Ltd — R2 Browser Buyer 2026-10-30; `01a18dc8-456d-77fa-b065-5cacce1abc43`; Closed Won |
| Main proposal | v1 Accepted; subtotal INR100000, tax INR18000, total INR118000, advance INR25000 |
| Transfer lead | #116 R2 Agent Transfer Buyer 2026-10-30; `01a18dcb-4a40-7a22-9944-6cedaf88f8fc`; owner Alpha, current holder Beta |
| Approval/loss lead | #117 R2 Approval and Loss Buyer 2026-10-30; `01a18dcd-ac8a-706f-ac89-3c8a2a1bcf46` |
| Approval/loss deal | #258; `01a18dce-0984-70cb-adb5-9c77d01f84aa`; Lost, No budget; custom-term approval still Pending |

## Browser verification

| Scenario | Result and evidence |
| --- | --- |
| Team → child pool → territory | PASS. Saved through UI. Territory coverage changed immediately to 1 configured and rendered the new team/pool. |
| Manual outbound lead capture | PASS. #115 saved with name, email, synthetic phone, company, requirement, location, language, and notes entered. Lead details display contact identity. Persisted advanced details still require independent verification because detail UI does not expose them. |
| Callback schedule | PASS. #115 showed 31 Oct 2026 10:30, pending, owner admin, reason, and `callback.scheduled` activity. |
| Callback reschedule | FAIL R2-01. Button saved a replacement callback, but at the wrong time. See findings. |
| Callback complete | PASS. Replacement callback showed completed / connected, and activity showed `callback.completed`. Lead still displayed Callback Scheduled before conversion; no remaining pending callback was visible. |
| Manual lead conversion | PASS. #115 converted directly to #257 without a contact fixture. New deal displayed its contact, service, scope, and expected close 5 Nov 2026. |
| Converted lead lifecycle | PASS. Originating lead showed Converted; Convert to deal action disappeared. |
| Proposal draft/autosave/publish | PASS. Entered line item, price, 18% tax, advance, validity, scope/exclusions/timeline. UI showed Saved, correct totals, then Published; fields became disabled. |
| Public proposal identity/totals | PASS. New tab displayed full deal title, Version 1, validity, item, subtotal/tax/total, advance, scope/exclusions/timeline, and customer response actions. |
| Public customer request changes | FAIL R2-02. Filled comment submitted twice, including typed input; UI returned `comment: Required`. |
| Public acceptance | PASS. Explicitly nonbinding QA proposal showed Accepted at 30 Oct 2026 22:38:42; admin reload showed v1 Accepted. |
| Advance confirmation | PASS. Internal synthetic INR25000 receipt saved; deal changed to Advance confirmed and removed the payment readiness blocker. No funds moved. |
| Delivery brief review loop | PASS. Draft → Submitted → Changes requested with reviewer note → revised fields → Submitted. |
| Delivery acceptance project selector | PARTIAL. Modal now offers project search and picker plus optional UUID. Tenant had no clients/projects. Prepared a synthetic client form; credential entry/submission handed to user under computer-control requirements. Project link acceptance remains pending. |
| Official win | PASS. Submitted brief plus accepted commercials and confirmed simulated advance produced “All close conditions met.” Record win succeeded; #257 showed Closed Won, 100% probability, Won at 22:40:18. |
| Approvals and wins queues | PASS for loading. Both load without the previous authorization errors. Wins showed old open #256 with payment blocker and excluded new won #257. |
| Reports | PASS for win aggregation. October totals showed WON1 / LOST0 / OPEN1, won INR118000, admin closer1 win / INR118000 before the loss scenario. |
| Agent outbound team context | PASS. New #116 automatically displayed QA Sales Team 2026-10-30. |
| Handover target candidates | PARTIAL. Both Alpha and Beta now appear as Sales agents; both disabled with not punched in. Direct available-receiver transfer remains unexecuted. |
| Team-queue handover | PASS. Alpha queued #116; Beta saw it in Handovers, claimed it, then Finalize accepted succeeded. Lead details preserved Alpha as owner and changed current holder to Beta; activity showed offered/accepted/disposition recorded. |
| Attendance prerequisite | BLOCKED / R2-03. Both QA agents' Today pages show Not yet in and disabled Punch In/Out. Read-only Alpha API returned row:null and allowedMoves:[] (HTTP200). No attendance state was fabricated. |
| Admin reassignment | NOT COMPLETED. New picker opens correctly; isolated tenant contains no Sales Agents, so no eligible candidate appeared. Original agent role does not expose Reassign. |
| Custom-term approval request | PASS for gate/submission. Publishing blocked, then Request approval appeared and submitted successfully. Approvals queue showed the request. Independent decision is unexecuted: tenant has no eligible independent approver. |
| Pipeline Discovery → Proposal | PASS on #258. Deal showed Proposal / probability25%. |
| Mark lost | PASS. #258 changed to Lost / No budget with timestamp; terminal actions disappeared. |
| Approval cleanup after loss | FAIL R2-04. Closed-lost #258 remains Pending in the actionable Approvals queue. |

## Remaining findings

### R2-01 — Callback “Reschedule +1h” computes the wrong organization-local time

At approximately 22:37 IST on 30 October, #115 had a pending callback for **31 October 10:30**. Clicking Reschedule +1h created a new pending callback for **30 October 18:07** and marked the original rescheduled. This is earlier than the current local time and earlier than the original callback, rather than either interpretation of +1 hour.

Source confirmation: `packages/client/src/company/sales/leads/LeadDetailsPage.tsx:21` takes `Date.now()+1h`, serializes UTC with `toISOString().slice(0,16)`, then interprets that string again as organization-local time with `organizationLocalToIso`. Both the time basis and timezone conversion need clarification/correction.

### R2-02 — Public proposal change request sends the wrong property

On #257 public v1, Request changes returned **comment: Required** with a nonempty comment. Retried with typed input and reproduced. Acceptance on the same proposal succeeded afterward.

Source confirmation: `packages/client/src/company/sales/proposals/PublicProposalPage.tsx:183` posts `{ question: ... }`; `packages/server/src/modules/sales/proposals/portal/public-routes.ts:34` requires `{ comment: ... }`.

### R2-03 — Attendance readiness prevents direct-offer testing, while queue claim bypasses the visible readiness gate

Alpha and Beta appear in handover candidates as not punched in. Their Today pages show disabled Punch In and Punch Out. Read-only `GET /api/attendance/live?self=true` for Alpha returned HTTP200 with `{row:null,allowedMoves:[]}`. This may be missing QA schedule/presence setup rather than a Sales defect; direct-offer availability has not been established.

Nevertheless Beta successfully claimed and finalized the team-queue handover while still not punched in. Whether team-queue claims intentionally permit off-duty agents needs a product decision and a consistent rule. The successful transfer is observed; eligibility enforcement is not claimed to pass.

### R2-04 — Pending approval remains in the queue after its deal is lost

#258 requested custom-term approval, then was marked Lost / No budget through the UI. Its detail still showed Approval Pending, and returning to Approvals showed the same pending request with SLA and no eligible approver. The operational queue continues presenting a terminal deal as awaiting a decision.

### R2-05 — Read-only proposal fields are blank after reload although summary retains values

After accepting #257's proposal publicly and reloading the admin proposal page, the Version1 summary retained validity 15 Nov 2026, scope, exclusions and timeline. The corresponding disabled date/scope/exclusions/timeline form fields were blank. Monetary fields remained populated. This is a presentation consistency defect; persisted loss is not inferred.

## Still to finish

- Synthetic client credential handoff → create project in UI → accept delivery brief with project picker → verify project association.
- Eligible administrative reassignment with callback/activity transfer; no suitable employee fixture exists in isolated tenant yet.
- Direct handover to an on-duty receiver; queue callback/rejection and re-engagement variants.
- Independent approval decision, contract-required flow, cancellation/refund/reversal, inbound connector/provider ingestion, competing bids, and renewal/targets remain unverified in this retest.

No assertion that “everything is fixed” is supported by this run. The fresh capture-to-official-win chain and queued transfer are live-browser passes with the limitations above.
