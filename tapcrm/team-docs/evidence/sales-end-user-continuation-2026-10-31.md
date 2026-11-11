# Sales browser continuation — 31 October 2026

> **Fix retest completed:** [31 October regression verification](sales-fix-retest-2026-10-31.md) passes R3-01, R3-02, R3-03, and the reproduced off-duty queue-claim bypass in R2-03 after rebuilding the runtime. Findings below describe the earlier run; read the fix retest for current evidence and coverage limits.

**Result: additional callback, handover, reporting, and advance-validation checks completed. The complete Sales module remains a partial pass.** This continues the [30 October browser retest](sales-end-user-retest-2026-10-30.md); it does not replace that run or establish that its remaining defects are fixed.

## Runtime and boundaries

- Local UI `http://localhost:5173`, controlled in real Chrome through native accessibility controls. Existing QA Alpha, QA Beta, and Isolated QA Organization Admin sessions were reused.
- Docker inspection confirmed the client/server images from the 30 October 22:28 IST rebuild are running; server, PostgreSQL, and Redis are healthy. No rebuild, migration, source fix, credential change, new account, or attendance fabrication was performed in this continuation.
- All callback outcomes, handover offers/claims/dispositions, and simulated receipt actions below were performed through Chrome. PostgreSQL queries were read-only and restricted to named synthetic QA records and the isolated tenant's account-type counts.
- Times below use Asia/Kolkata. Database evidence retains explicit UTC offsets. This continuation occurred around 02:49–02:54 IST on 31 October; its database timestamps therefore still have the UTC date 30 October.
- No funds moved. The receipt reference is `QA-SIMULATED-NO-FUNDS-R3-REVERSAL`, with a note explicitly stating that no funds were received or moved.

## Additional browser results

| Scenario | Result / observed evidence |
| --- | --- |
| Accepted handover → callback | PASS. On synthetic lead #118, Beta clicked Callback +1h. The handover displayed Callback and the lead displayed Callback Scheduled, with callback.scheduled / callback.requested / handover.disposition_recorded activity at 02:49:52. |
| Follow-up routes to relationship owner | PASS. Beta's callback list was empty; Alpha's list contained #118 for 31 October 03:49, Pending, owned by Alpha. This agrees with callback-service.ts, which resolves the originating agent, then owner, then holder. The +1h handover action used the correct absolute time, unlike the separate lead-detail reschedule defect R2-01. |
| Callback not-reachable outcome | PASS. Alpha opened the callback and clicked Not reachable. Detail showed Not Reachable / outcome Not Reachable; action buttons disappeared. Persisted status and outcome are both not_reachable. |
| Second queued handover | PASS. Beta, still current holder, queued #118 again. Alpha saw the pending offer, claimed it, and then clicked Reject. Detail displayed Rejected with time-to-accept 11s and time-to-outcome 4s. |
| Rejection closes lead | PASS. Lead #118 displayed Closed Lost, loss reason Other, lost at 31 October 02:50:56. Owner and current holder were both Alpha. Convert to deal was absent. PostgreSQL confirmed the terminal state. |
| Terminal-lead handover guard | PASS at API, FAIL in UI affordance. Queue for Sales team remained enabled on #118. Clicking it returned “A converted or closed-lost Lead cannot be handed over”; no new handover was created. |
| Re-engagement aggregate | PARTIAL. Alpha saw one closed-lost lead, QA Outbound source, loss reason other, count 1. Lost date was 2026-10-30, inconsistent with the organization-local date in lead details. See R3-01. |
| Re-engagement capture | NOT EXECUTED. The advanced New Lead form exposes company/campaign/location/language/notes, but no previous-lead selector or identifier. The inspected closed-lost detail also offers no re-engage action. No replacement lead was created. |
| Admin report after deal loss | PASS. October report displayed Won 1 / Lost 1 / Open 1, won INR118000, No budget 1, and Isolated QA Organization Admin with 1 win / INR118000. This is deal reporting; the separate closed-lost lead #118 is not counted as a lost deal. |
| Zero advance | PASS, UI guard only. Entering zero and a reference kept Confirm disabled. No zero-value API request was submitted. |
| Below-required advance | PASS, business validation. On older synthetic deal #256, INR1 against an expected INR60000 was rejected. After closing the modal, the page showed “Confirmed amount (100) is below the expected advance (6000000).” Payment stayed Unpaid. See R3-03 for presentation defects. |
| Valid simulated advance | PASS. INR60000 with the explicit QA/no-funds reference and note saved on #256; Payment became Advance confirmed. Record win became enabled. No win was recorded on this older deal. |
| Same-initiator reversal | EXPECTED DENIAL. The confirming admin entered a QA reversal reason and clicked Revert. After closing the modal, the page showed the A1 segregation-of-duties denial, explicitly binding Super Admin. Payment remained Advance confirmed. An independent authorized principal is required to complete the reversal; no second account was provisioned. |
| Capture details retained | PASS, read-only DB supplement to the earlier UI run. #115 retained requirement, location “Kolkata QA region”, language “English”, and the R2 intake-note marker. Its status remains converted. |

## Remaining / clarified findings

### R3-01 — Re-engagement day grouping uses the database day

Lead #118 was lost at `2026-10-30T21:20:56.436355+00:00`, which is **31 October 02:50:56 Asia/Kolkata**. Lead details showed that local date, but the aggregate displayed **2026-10-30**. `packages/server/src/modules/sales/leads/reengagement-service.ts` groups with `date_trunc('day', l.lost_at)::date`, without applying the organization timezone. This produces inconsistent day buckets for an organization operating ahead of UTC.

Repair direction: group and render the organization-local calendar day, and verify events either side of local midnight.

### R3-02 — Terminal leads still expose handover actions

Closed-lost #118 still displayed an enabled Queue for Sales team button. The server correctly rejected the request. Hide or disable the action for terminal leads and explain the terminal state before submission. This is an affordance defect, not an authorization bypass.

### R3-03 — Advance errors remain behind the modal and use minor units

Both the below-advance business error and the reversal A1 denial were absent from the active modal's accessibility content. Closing each modal exposed the page-level message. The amount error also rendered `100` and `6000000`, although the form used INR1 and INR60000. Users should see the actionable error within the open modal, with amounts formatted in the currency/unit used by the form.

### R2-03 clarified — Queue claim omits a real presence check

Source inspection explains the earlier off-duty queue claim. `handover/repository.ts`'s `loadSelectableHandoverTargetTx` returns `availability: 'working', selectable: true` for a role-eligible account, with a comment assuming the caller already checked live presence. `claimQueuedHandoverForUser` calls that helper without the live-presence check used in direct acceptance. The direct/queued eligibility inconsistency is source-corroborated; no on-duty attendance journey was established.

### Close-readiness limitation observed

After the simulated receipt, #256 displayed All close conditions met while its delivery brief was still Draft with mostly blank fields. Current `deals/won-readiness.ts` explicitly permits any existing non-cancelled brief, including Draft. This observation matches the current implementation; it does **not** establish delivery acceptance or a completed project handoff. #256 was left open.

## Retained state and evidence

- #118 `01a18dd2-904e-7b0f-ae39-3a8a55470f85`: closed_lost / other; Alpha owner and current holder.
- Callback `01a18eae-f1f3-7951-b3e7-41e0bb407d26`: Alpha owner, scheduled 31 October 03:49 IST, not_reachable.
- First handover `01a18dd2-a0eb-70d2-8523-e6ca1f487e41`: Alpha → Beta, accepted / callback.
- Second handover `01a18eaf-b0d8-7d57-b1f8-2bbca95916af`: Beta → Alpha, accepted / rejected.
- **#256 is now open / advance_confirmed with the synthetic INR60000 receipt. Reversal did not succeed.** Its brief remains Draft. Do not treat this receipt as real money or report the reversal as completed.
- #257 remains won / advance_confirmed; #258 remains lost / approval_pending. The earlier pending-approval cleanup finding remains unresolved in persisted state.
- The isolated tenant contains one Super Admin account and no employee account; independent approval/reversal and reassignment were not available there.
- [Machine-readable persisted evidence](sales-qa-2026-10-31/persisted-state.json) contains only selected synthetic QA fields; no password, session token, or public proposal bearer token is included.

## Work still requiring setup or a separate configured test run

- Delivery/project acceptance still needs a client/project. The prior new-password handoff remains unresolved. This continuation did not bypass it through an API.
- Administrative reassignment and independent commercial approval/reversal require suitable existing authorized QA principals. No access was expanded.
- Direct handover requires a receiver with genuine on-duty presence. No attendance rows were fabricated.
- Actual linked re-engagement creation, competing bids, provider ingestion/notifications, contract-required signing, cancel-after-win/refund handling, payment replay/idempotency, renewals, targets, and stalled/expiry automation remain unverified.

The fresh capture-to-win pass from the previous run still stands. These additional passes and limitations do not support a claim that the whole Sales module is ready.
