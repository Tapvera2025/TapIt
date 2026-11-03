# Sales fix retest — 31 October 2026

> Later testing: [remaining Sales flow QA](sales-remaining-flow-qa-2026-10-31.md) verifies the callback/public-response fixes and finds Mark Lost and cancel-after-win blockers. #259 has since become Won with a simulated advance and a cancelled brief; its older Unpaid state below is historical.

**Result: all four requested regression checks passed in live Chrome after rebuilding the local runtime.** This closes the reproduced cases for R3-01, R3-02, R3-03, and the off-duty claim bypass in R2-03. It does not establish a complete Sales-module pass or an on-duty handover success.

## Runtime verification

- UI: `http://localhost:5173`; real Chrome, native accessibility controls and visual inspection.
- Existing sessions: Isolated QA Organization Admin, QA Sales Agent Alpha, and QA Sales Agent Beta. No accounts, credentials, permissions, or attendance records were created or altered for this retest.
- Initial running images contained older versions of all four changed files. Ran `docker compose up -d --build migrate server client`; TypeScript builds passed, migration service exited successfully with no pending migrations, server became healthy, and client started successfully.
- After recreation, SHA-256 checks matched the checkout and running containers for all four files. Server runs its compiled build; client runs Vite against the source copied into its image. Browser pages were refreshed/reloaded before assessing the changed behavior.
- Six focused existing test files passed: **32 tests, 0 failed, 0 skipped**. They cover handover validators/policy/repository and deal validators/routes/manual-payment readiness. These tests supplement the browser evidence; they do not independently exercise every new branch.
- Retest browser actions occurred around 03:00–03:03 IST on 31 October. Machine-readable database evidence retains explicit UTC timestamps.

## Results

| Finding | Result | Live evidence |
| --- | --- | --- |
| **R3-01 — Re-engagement day grouping** | **PASS** | Alpha opened Re-engagement. The existing loss for #118 appeared with count 1 and Lost date **2026-10-31**, replacing the earlier incorrect 2026-10-30 bucket. Its persisted lost_at is 2026-10-30T21:20:56.436355+00:00, corresponding to 31 October 02:50:56 Asia/Kolkata. Read-only SQL also verified local date immediately before and at midnight. |
| **R3-02 — Terminal lead handover controls** | **PASS, both terminal states** | Alpha opened closed-lost #118; Live-call handover showed history without receiver, Offer handover, or Queue for Sales team controls. Admin opened converted #115; its handover panel likewise exposed no offer/queue controls. Both identities were the respective lead owners/current holders, so absence was not explained by using an unrelated account. |
| **R3-03 — Reversal modal error** | **PASS** | Admin attempted reversal on synthetic #256, which that admin had previously confirmed. The A1 segregation-of-duties error remained visible inside the still-open Revert advance confirmation modal. Screenshot inspection confirmed the inline red error panel; source declares role="alert". Reversal remained denied and payment state did not change. |
| **R3-03 — Confirmation modal and money units** | **PASS** | Created fresh synthetic lead #119 → deal #259 → published nonbinding proposal with INR100000 total and INR60000 expected advance. Entered INR1 and an explicitly simulated QA reference. The open confirmation modal displayed **“Confirmed amount (₹1.00) is below the expected advance (₹60,000.00).”** Screenshot inspection confirmed the message inside the modal. The new deal remained Unpaid. |
| **R2-03 — Off-duty queue claim** | **PASS, denial case** | Beta queued existing synthetic #116. Alpha's Today page showed Not yet in, disabled Punch In/Out, and no activity. Alpha opened the new pending offer and clicked Accept / Claim. The detail displayed **“You are not currently punched in or available”** and stayed Pending. Read-only PostgreSQL confirmed Alpha's presence state NOT_IN, handover to_user_id/accepted_at still null, and current holder still Beta. |

## Read-only boundary and state checks

- Organization timezone is Asia/Kolkata. The same timezone expression used by the fix maps `2026-10-30T18:29:59Z` to local date **2026-10-30**, and `2026-10-30T18:30:00Z` to **2026-10-31**. These are computed SQL boundary checks, not fabricated lead records.
- #259 is **open / unpaid**, payment initiator null after the rejected INR1 probe. No successful receipt was created in this retest.
- #256 retains the earlier explicitly simulated INR60000 confirmation. Its attempted reversal was denied again. No funds moved.
- #116 remains **assigned**, owner Alpha / current holder Beta. New handover `01a18eba-fb3e-7d06-9e10-b95b5794b82b` was Pending and unclaimed at the final database check; normal expiry remains available.

## Created and retained QA records

| Record | Identifier / retained state |
| --- | --- |
| #119 R3 Fix Retest Buyer 2026-10-31 | `01a18eb9-9293-7e82-9fa9-bc3d49d977f7`; converted normally through UI |
| #259 R3 Fix Retest Buyer 2026-10-31 | `01a18eb9-ba7b-7785-8080-0301b11467ac`; open / unpaid |
| #259 proposal v1 | Published; INR100000 total / INR60000 expected advance; explicitly nonbinding QA scope |
| New #116 team-queue offer | `01a18eba-fb3e-7d06-9e10-b95b5794b82b`; Beta → unclaimed at final check |

No public proposal link was sent to anyone. No password, session token, or proposal bearer token is included in this report. [Machine-readable verification](sales-qa-2026-10-31/fix-retest-state.json) records the selected persisted checks, runtime source hashes, and test result.

## Coverage limits

- R2-03's reproduced bypass is fixed for a genuinely off-duty NOT_IN agent. WORKING success, ON_BREAK denial, missing-presence-row denial, and concurrent claims were not newly exercised live. No attendance state was fabricated to force those branches.
- R3-02 covered terminal leads without a currently active handover. This run did not construct a terminal lead with a pre-existing pending/accepted unresolved handover.
- R3-03 covered INR formatting for the reproduced below-advance error and the unchanged A1 error in the reversal modal. Other currencies and successful independent reversal were not tested.
- Earlier findings outside these four requests remain governed by the [30 October retest](sales-end-user-retest-2026-10-30.md) and [31 October continuation](sales-end-user-continuation-2026-10-31.md), including project acceptance, approval cleanup, callback rescheduling, and public change requests. Their closure is not implied here.
