# TapCRM Finance Module — PRD v2.0

**Status:** Draft for review
**Supersedes:** Finance sections of PRD v1.8 (13, 4, 6, 7, 18, 19, Appendix B)
**Scope:** The finance department of TapCRM — billing, invoicing, payments, receivables, payables, accounting, and the controls, reporting, platform and user-facing flows around them.
**Non-goals (unchanged from v1.8 §1.6):** inventory and COGS, delivery challans, e-way bills, multi-jurisdiction VAT, multi-entity consolidation at launch.

---

## 1. Vision

> **A finance system that behaves like it was built for people who close deals, not for people who process invoices.**

TapCRM Finance is the only product in the market that sees the full lineage from first conversation to realised revenue — because it is a CRM. Finance leaders adopt it because it gives them governance that no SaaS competitor matches (segregation of duties that binds the root admin, pricing authority locked to a single principal, hash-chained audit log) **and** convenience that competitors do have (bank feeds, OCR, pay-now, external accountant access). India-first depth (TDS, GST, MSME 43B(h), RCM) is a built-in advantage, not an add-on.

## 2. Design principles (non-negotiable)

These are inherited from v1.8 and remain the test every requirement is measured against. Any change requires Super Admin written approval.

| ID | Principle |
|---|---|
| **FP-1** | **Ledger is the only source of truth for money.** Reports and statements never show figures computed from the pipeline. |
| **FP-2** | **Documents, not edits.** Issued invoices, posted receipts and posted journals are immutable; corrections create a linked document (credit note, reversal, debit note). |
| **FP-3** | **Statutory rules are not negotiable.** GST, TDS, e-invoicing, gapless numbering and period-close integrity run regardless of role or workflow preference. |
| **FP-4** | **Segregation of duties binds everyone.** The person who records cannot reconcile; the person who raises cannot approve; the person who posts cannot close the period. The root administrator is not exempt. |
| **FP-5** | **Pricing authority is single-principal.** Only Super Admin writes billing terms. Never grantable, never delegable, even when Finance is staffed. |
| **FP-6** | **Numbers are allocated at issue, not at draft.** Abandoned drafts leave no gap. |
| **FP-7** | **Finance ships built, staffed later.** Finance department and both positions ship inactive; Super Admin holds the capabilities and grants individual actions until a Finance Manager / Accountant is hired. |
| **FP-8** | **Zero-fabrication rule.** When data is unavailable (no CrUX, no 26AS entry, no bank feed, no provider configured), the UI shows the state honestly. Never substitute a zero or a stale value for a missing one. |

## 3. Module architecture

Six sub-modules (N1–N6) plus one cross-cutting layer (XF). All exist on day one, even if staffed later.

```
N1  Billing terms          — the commercials rulebook
N2  Invoicing              — producing invoices
N3  Payments               — receiving money
N4  Receivables            — chasing money
N5  Payables               — spending money
N6  Accounting             — the ledger of record
XF  Cross-cutting          — controls, reporting, platform
```

---

## 4. Core user flows (the "best flows")

These are the shapes the module optimises for. Features are tested by whether they make these flows feel inevitable.

### Flow A — Deal to cash (unique to TapCRM)

**Trigger:** Sales records a deal win.

1. Deal is won in CRM → prompts for advance receipt amount, date, method, reference.
2. Advance receipt is **posted immediately** (Dr Bank / Cr Customer Advances). The receipt is linked permanently to the deal. **A deal cannot be marked won without this receipt** (RCPT-4 / DL-4c).
3. Project is auto-created from the deal; billing terms inherit from the client (BT-9).
4. First invoice is drafted using the deal value **less the advance** (IN-1). Draft, not issued.
5. Finance Manager (or Super Admin while Finance is inactive) reviews, approves, issues.
6. Issue allocates the next gapless number, posts Dr AR / Cr Revenue / Cr GST Payable, publishes to the client portal with pay-now, and starts the AR clock (IN-18, IN-19).
7. Client pays via pay-now link **or** the gateway webhook settles → receipt is auto-created, allocated to the open invoice, applied against the advance liability.
8. Project profitability (PJ-14) reflects the recognised revenue against logged time cost.

**What makes this standout:** every event has one owner, one document and one journal. Chain of custody is visible in a single screen on both the deal and the invoice.

### Flow B — Monthly retainer run

**Trigger:** 1st of the month, 06:00 IST (configurable).

1. Scheduler finds every active retainer with a billing schedule due this period.
2. For each: generate a **draft** invoice using the current rate card (BT-4) and dimension tags (project / client / dept).
3. Finance Manager reviews the retainer batch screen → bulk-issue with per-invoice error report (N2-NEW-08).
4. Issued invoices publish to the client portal; invoices with pay-now links or saved e-mandates (N3-NEW-07) auto-collect.
5. Successful auto-collections post receipts immediately; failures route to the collections queue with a retry schedule.
6. On the 7th, TDS liability register (N5-NEW-01) reminds Finance of the challan deadline.

**What makes this standout:** rate-card version is pinned per issued invoice (BT-5) — a mid-month price change never silently rebills last month's retainer.

### Flow C — Vendor bill to payment (with India compliance)

**Trigger:** Vendor sends a bill (PDF, email, or shared via vendor portal).

1. OCR capture (N5-NEW-07) extracts vendor, line items, tax lines → creates a draft bill with confidence flags.
2. Bill is matched to a PO if required (N5-NEW-06). GST eligibility runs; blocked credit is flagged (VB-2).
3. If vendor is unregistered or in an RCM category → self-invoice auto-generated (N5-NEW-02), GST payable posted, ITC schedule created.
4. If vendor is MSME-flagged → due date is capped at 45 days (N5-NEW-04); alerts at D-15, D-7, D-0.
5. Approval routes to the Finance Manager (or Super Admin) with SoD enforcement (VB-6: raiser ≠ approver ≠ executor).
6. Approved bills queue for the next payment run (VB-5); run generates an NEFT/RTGS bulk upload file (N5-NEW-08) **or** direct payout via bank API.
7. On execution, payment net of TDS is posted; TDS liability register updates; vendor is notified via email + optional WhatsApp.
8. Vendor portal (N5-NEW-11) shows the payment status without a human reply.

**What makes this standout:** three India-first automations in one flow — OCR → RCM self-invoice → MSME 45-day watchdog — none of which Zoho, Odoo or Tally does fully.

### Flow D — Dispute-aware receivables

**Trigger:** Dunning cadence detects an overdue invoice.

1. Automated reminder sent via email + optional WhatsApp (RC-3 / RC-4).
2. Reminder includes a one-click **"I dispute this"** link that opens the client portal (CL-6c).
3. Client raises a dispute with reason + optional attachment (receipt, screenshot, email).
4. Dunning **pauses automatically** for this invoice (RC-3).
5. A dispute task is created and routed to the deal owner + Finance Manager. Both get notifications.
6. Deal owner opens the invoice → sees the dispute thread + original deal commercials + delivery sign-off (if any) in one screen.
7. Resolution: credit note (fully or partially credits the invoice), amendment (new invoice replacing the disputed one), or dispute-close (dunning resumes).
8. Collection KPIs (N4-NEW-04) exclude disputed days from DSO.

**What makes this standout:** every competitor pauses dunning manually. TapCRM pauses on the dispute, and the dispute is one click from the invoice the client already received. Deal-level context sits one click away.

### Flow E — Month-end close (controlled)

**Trigger:** Finance Manager initiates close for a period.

1. Close checklist (LG-10) presents required items: bank reconciliations complete, TDS challans paid, GST returns filed/queued, unposted drafts cleared, foreign-currency revaluation run.
2. Each item has a status (green/amber/red) with drill-through to the exceptions.
3. Close button is disabled until all items are green **or** marked explicitly "accepted with reason" (with a required note).
4. On close, period is locked; nothing posts to the closed period including Super Admin (A4).
5. Automatic journals fire: accruals reverse into next period, prepayments amortise, FX unrealised gain/loss revalues open foreign balances (N6-NEW-07, N6-NEW-05).
6. Management pack generates automatically (XF-NEW-05): P&L, balance sheet, cash flow, KPIs, and a one-page commentary stub for the Finance Manager to fill in.
7. Reopen requires Super Admin with written reason (LG-11), audited with before/after values and timestamp.

**What makes this standout:** the pre-close checklist is machine-verified, not a Google Doc. SoD binds the person closing — whoever posted a journal cannot be the one who closes the period (LG-16).

### Flow F — The Finance Copilot (standout feature)

**Trigger:** Finance Manager types a question in natural language, or clicks an insight card on the dashboard.

Supported interactions at MVP:
- "Which clients are more than 60 days overdue and over ₹100,000?"
- "What's our cash runway at the current burn rate?"
- "Show me vendors we might be MSME-non-compliant on this month."
- "What invoices have the biggest unexpected drop in payment time vs their usual pattern?"

Rules of engagement:
- Read-only — the Copilot never writes, posts, or changes anything.
- Permission-aware — it only reads data the asking principal can read.
- Audit-trailed — every question + answer is logged under `finance:copilot-query`.
- Honest about absence — "I don't see any GSC data for August; the sync may be behind" instead of inventing a zero.
- Suggestion mode — the Copilot can suggest a draft action ("I'd propose writing off these 3 invoices totalling ₹14,500 under your client ceiling") but **never execute**. Execution requires a human on the normal document path.

---

## 5. Feature inventory (phased)

Features are grouped by phase, then by module. **Existing** means already in PRD v1.8. **NEW** items use the IDs from the v1.8 benchmark gap analysis.

### Phase 0 — PRD issue resolution (2 weeks, blocking)

Before any code moves, these ambiguities from the v1.8 review must be closed:

| # | Issue | Decision needed |
|---|---|---|
| 0.1 | Write-off vs credit-note posting (LG-4 / RC-8) | Define write-off as a distinct document type (bad-debt note) with its own posting rule: `Dr Bad Debt / Cr AR`. Credit note stays as revenue reversal. State the GST treatment for bad-debt. |
| 0.2 | Accountant persona vs permission matrix | Reconcile §2.3 (Accountant posts journals) with §6 (Accountant = accounting read-only). Decision: Accountant **can** post journals but **cannot** close periods or amend posted ones. Matrix updated. |
| 0.3 | GST on advances | Pending BD-27 (tax review). Default: generate a receipt voucher and post GST on advance to a liability account, netted on invoice issue. |
| 0.4 | FX accounting incompleteness | Add realised + unrealised FX gain/loss accounts to LG-2 seed. Add explicit revaluation requirement (see N6-NEW-07). |
| 0.5 | Invoice lifecycle wording | Clarify: an issued invoice is **never** cancelled as a state. Full credit by credit note is the only "cancel" path. |
| 0.6 | Deal-won owner | One owner. Default: Sales Department Head. PM gets a queue of won deals to action but doesn't record the win. |

### Phase 1 — Finance go-live (table stakes)

The 14 items that must be live before announcing finance is "ready." Grouped by module.

**N1 Billing terms**
- `N1-NEW-01` **Service catalogue** — services with default HSN/SAC, tax treatment, income account; linked to rate cards; removes keying errors on IN-6.

**N2 Invoicing**
- `N2-NEW-01` **Quotes / estimates** → convert into invoices; versioned, numbered, accept/decline tracking; links to deal commercials.
- `N2-NEW-02` **Milestone / stage billing schedules** on projects; stages with amount or %, triggered by date or sign-off; generates draft invoices and ties to LG-8 recognition.
- `N2-NEW-11` **Contract master** — term, billing rule, renewal, amendment history; linked to client + deal + project; extends PC-3 / PC-3b.
- `N2-NEW-12` **Billable expense pass-through** — out-of-pocket costs rebilled to client with optional markup, as linked invoice lines.
- `N2-NEW-X1` **Advance-receipt handling** — receipt voucher + GST on advances (closes PRD issue 0.3).

**N3 Payments**
- `N3-NEW-01` + `N3-NEW-02` **Pay-now link on invoice + client portal payment** — UPI, cards, net banking; gateway webhook creates receipt and allocates automatically.
- `N3-NEW-03` **Automatic bank feeds** — bank APIs or account-aggregator provider fills the reconciliation queue daily.
- `N3-NEW-04` **AI-assisted matching rules** for bank lines; human confirmation stays mandatory (RCPT-8).
- `N3-NEW-05` **Payment gateway with fee + settlement reconciliation** — fee capture, settlement-to-receipt match, refunds through gateway, failed-payment handling.

**N5 Payables**
- `N5-NEW-07` **OCR for vendor bills and receipts** — draft bills with confidence flags.
- `N5-NEW-01` **TDS liability register + challan tracking** — ITNS 281 recording, section-wise, monthly 7th-reminder.
- `N5-NEW-02` **RCM auto self-invoice** — unregistered-vendor and GTA bills generate self-invoice, GST payable, ITC-on-payment schedule.
- `N5-NEW-08` **NEFT/RTGS bulk payment file** from payment run, with optional direct payout.
- `N5-NEW-05` **Vendor master** with PAN, GSTIN, bank, MSME flag, TDS section defaults; duplicate detection; bank-change approval.

**N6 Accounting**
- `N6-NEW-04` **Recurring + scheduled journals** — subject to A4 and reason rule.
- `N6-NEW-06` **Multi-dimensional tagging** — department, project, client, location, cost centre on every posting line.
- `N6-NEW-07` **Multi-currency with FX revaluation** — rates by date, realised + unrealised gain/loss, month-end revaluation, FX difference on allocation. Closes PRD issue 0.4.
- `N6-NEW-09` **Fixed asset register + depreciation** — SLM/WDV, Companies Act + Income-tax Act, automatic monthly journals.
- `N6-NEW-10` **Budgets + budget-vs-actual** — annual + monthly, by account and dimension, with approval of budget versions.

**XF Cross-cutting**
- `XF-NEW-08` **External accountant / auditor role** — read-only, review-only, time-boxed, with comments and export permission; subject to every absolute constraint.
- `XF-NEW-10` **Public REST API + webhooks for finance** — invoices, receipts, bills, journals; authenticated by service accounts.
- `XF-NEW-01` **Project budget vs actual with overrun alerts** — hours + money with warnings at 75/90/100%.
- `XF-NEW-03` **Custom report builder on financial data** — ledger, receivables, payables; saved views; permission-aware fields.

**Phase 1 total:** 14 new features + 6 PRD issue resolutions + the 56 existing requirement groups from v1.8.

### Phase 2 — Standout layer (ships 2-3 months after go-live)

The features that make TapCRM finance genuinely differentiated, not just complete.

| ID | Feature | Why standout |
|---|---|---|
| `N5-NEW-04` | **MSME 45-day compliance watchdog** | Section 43B(h) exposure. Only Zoho has it partial; TapCRM would be the first to do end-to-end (flag + alert + year-end non-deductible report). |
| `XF-NEW-15` *(new)* | **Chain-of-custody UI** | Visualise deal → advance → invoice → receipt → recognition → P&L on one screen. No competitor can show this because none are CRMs. |
| `XF-NEW-16` *(new)* | **Governance dashboard** | Make FP-4 (SoD) and FP-5 (pricing lock) visible: who can do what, what's locked, what's grantable. Audit-pitch feature. |
| `XF-NEW-17` *(new)* | **Finance Copilot (MVP)** | Natural-language questions over the ledger; read-only; permission-aware; suggests but never executes. See Flow F. |
| `XF-NEW-18` *(new)* | **WhatsApp-first collections** | Invoice delivery, payment link, dispute capture, statement-on-demand via WhatsApp. Expands H8. |
| `XF-NEW-19` *(new)* | **AI TDS 26AS reconciliation** | Auto-match 26AS entries to TDS-receivable journals, with ambiguous-case queue. Save 2-3 days per quarter per finance team. |
| `N3-NEW-06` | **UPI collect + dynamic QR** on invoices with auto-reconcile. |
| `N3-NEW-07` | **E-mandate / saved method for retainers** | Monthly retainer invoices collect themselves. |
| `N5-NEW-06` | **Purchase orders + three-way match** | Optional per vendor so small purchases stay frictionless. |
| `N6-NEW-05` | **Accruals + prepayments with auto-reversal** | Required for clean month-end close. |
| `N6-NEW-11` | **Cash-flow forecasting** | Rolling forecast built from AR + AP + payroll + recurring schedules + deal pipeline. The pipeline input is what makes this unique. |
| `N4-NEW-01` to `N4-NEW-04` | **Receivables depth** | Late fees, bad-debt provisioning, promise-to-pay, DSO/CEI KPIs. |
| `XF-NEW-04` | **Finance dashboards** with role-based tiles and `as of` stamps. |
| `XF-NEW-05` | **Monthly management pack** auto-generated at close. |
| `XF-NEW-09` | **Fraud + anomaly alerts** — round-number payments, off-hours postings, bank-detail changes before payment, repeated just-under-limit approvals. |

**Phase 2 total:** 15 features. 6 of these (marked with `XF-NEW-15..19` and the Copilot) are genuine net-new differentiators not present in any benchmarked competitor.

### Phase 3 — Depth on demand

Build only when a user asks or when scope expands.

- **Payables depth**: expense policy engine (N5-NEW-09), recurring bills + vendor DN/CN (N5-NEW-12), duplicate detection (N5-NEW-14), vendor portal (N5-NEW-11), early-payment discount capture (N5-NEW-13).
- **Compliance edge cases**: direct GST filing via GSP (N6-NEW-01), TDS return 24Q/26Q file prep (N6-NEW-02), multiple GSTINs (N2-NEW-10), ITC rules R42/43 (N5-NEW-03), IMS (N6-NEW-03).
- **Reporting depth**: revenue waterfall + backlog (N6-NEW-17), utilisation + realisation (XF-NEW-02), retainer hours bank (N2-NEW-13).
- **Invoicing nice-to-haves**: progress billing with retention (N2-NEW-03), template designer (N2-NEW-05), delivery tracking (N2-NEW-07), bulk send (N2-NEW-08), multi-language (N2-NEW-06).

### Phase 4 — Deferred (not in scope at any phase without explicit scope expansion)

- Multi-entity consolidation (`E11`) — depends on BD-21 multi-tenancy
- Full ASC 606 rule engine (`E19`) — Sage Intacct's moat
- Inventory + COGS (`E16`) — services-only scope rejection
- E-way bill (`B4`), delivery challan (`A19`) — goods only
- Multi-jurisdiction VAT (`B19`) — India-only scope
- TCS (`B12`) — rare for services, revisit on request
- Spreadsheet live connectors (`I9`) — CSV export suffices

---

## 6. Roles and permissions (updated)

Finance ships inactive — Super Admin holds everything until Finance is hired.

| Principal | Finance reach |
|---|---|
| **Super Admin** | All six modules + every protected capability. Grants individual finance actions until Finance Manager / Accountant are staffed. Exclusive holder of `billing:set-terms` (P8) and `accounting:reopen-period` (A4). |
| **Finance Manager** (inactive at launch) | invoicing, payments, receivables, payables, accounting at department scope. Read on billing terms is grantable; write never is. |
| **Accountant** (inactive at launch) | **Resolved per issue 0.2**: can post journals (`accounting:post-journal`) but cannot close/reopen periods and cannot write billing terms. Scope dept*. |
| **External Accountant / Auditor** (**NEW** per XF-NEW-08) | Read-only + comment-only on finance records, time-boxed access, export permission; cannot ever write, approve, or close. |
| **Project Manager** | Read-only (own*) on invoicing, payments, receivables for own clients. Cannot raise or alter. Can see chain-of-custody view (XF-NEW-15) for their projects. |
| **Deal Owner / Sales Dept Head** | Reads invoice + payment status for own deals. Records deal win which triggers advance receipt (RCPT-4). |
| **Every Employee** | `payables:claim` at own: submit and track own reimbursement claims. |
| **HR** | No finance access (P7). Payroll posts a one-way journal that HR cannot read (PY-12). |
| **Client** | Portal: own invoices, payments, statement, PDFs, pay-now, dispute raising (A2 + Flow D). |
| **Service accounts** | API access via SV-1..SV-9 for finance webhooks + REST (XF-NEW-10). |

---

## 7. Success criteria (Phase 1 acceptance)

Release criteria for finance go-live (extends AC-15b to 15d from v1.8):

- **AC-F1** Trial balance balances to the cent at all times across the test corpus.
- **AC-F2** Gapless numbering holds across concurrent issue of 500 invoices.
- **AC-F3** No principal including Super Admin can bypass P8 or A4.
- **AC-F4** Every statutory field present on every tax invoice; e-invoice IRN generated or queued; failed IRN prevents send.
- **AC-F5** Bank feed reconciles ≥80% of lines without manual intervention on a representative statement.
- **AC-F6** OCR extracts vendor, amount, GST on ≥85% of standard-template vendor bills.
- **AC-F7** Pay-now link on an issued invoice results in a posted receipt within 30 seconds of client payment success.
- **AC-F8** External accountant can produce a complete audit report (ledger drill-through, document attachments, before/after values on edits) without any write permission.
- **AC-F9** Deal-to-cash chain-of-custody view loads for any deal in <2 seconds.
- **AC-F10** Month-end close pre-check passes/fails deterministically; close locks the period; reopen requires Super Admin with reason.
- **AC-F11** Zero-fabrication rule: no report shows a figure that cannot be traced to a document; UI shows "no data" states explicitly.

---

## 8. Technical dependencies

| Dependency | Needed for | Owner |
|---|---|---|
| Bank-feed provider (account aggregator or direct bank API) | `N3-NEW-03`, `N3-NEW-04` | Finance Lead to procure |
| OCR provider (AWS Textract, Google Document AI, or self-hosted) | `N5-NEW-07` | Engineering |
| Payment gateway with webhook + settlement reports | `N3-NEW-01`, `N3-NEW-05` | Finance Lead (Razorpay / Cashfree) |
| GSP connector (optional, Phase 3) | `N6-NEW-01` | Finance Lead |
| WhatsApp Business API | `XF-NEW-18`, existing RC-3 | Already configured for CRM notifications |
| LLM API (Anthropic Claude or OpenAI) | `XF-NEW-17` Copilot, `XF-NEW-19` TDS 26AS match | Engineering (reuse SEO module infra) |

---

## 9. Phasing summary

| Phase | Duration | Items | Milestone |
|---|---|---|---|
| **0** | 2 weeks | 6 PRD decisions | Phase 1 unblocked |
| **1** | 4-6 months | 14 table-stakes features + existing v1.8 scope | Finance can go live |
| **2** | 2-3 months (overlaps Phase 1 end) | 15 standout features, 6 of them net-new | Finance is differentiated |
| **3** | Ongoing, on request | 25+ depth features | Finance is deep |
| **4** | Deferred indefinitely | 7 items | Documented out-of-scope |

**Totals:**
- 56 existing requirement groups from v1.8 kept.
- 54 new requirements across Phase 1-3 (14 + 15 + 25).
- 7 features explicitly deferred.
- 6 PRD issues resolved as prerequisites.

---

## 10. What this PRD deliberately bets on

Three bets any reviewer should push back on if they disagree:

1. **India-first wins the Indian mid-market** — betting that MSME, RCM, TDS automation and WhatsApp collections matter more than catching up to Sage Intacct on dimensions or ASC 606 depth. If true, Zoho is the real competitor, not Sage.
2. **CRM-native is a product category, not an integration** — betting that chain-of-custody, pipeline-aware cash forecast, and deal-contextual dispute resolution are features competitors cannot copy because they're not CRMs. If true, QuickBooks + HubSpot integrations never match the UX.
3. **Governance as a product surface** — betting that making SoD and pricing lock *visible* (governance dashboard, chain-of-custody view) is a sales-closing feature for CFOs who've been burned. If true, this is a differentiator worth marketing, not just a hidden capability.

If any of these bets is wrong, Phase 2 should re-prioritise.

---

## 11. Open questions for leadership

1. **Who procures the bank feed provider?** Blocks `N3-NEW-03`. Options: direct bank APIs (slow, bank-by-bank) vs account aggregator (Finvu, OneMoney — faster, needs client consent).
2. **Which OCR provider?** Blocks `N5-NEW-07`. Trade-off: self-hosted (control + privacy) vs managed (speed + accuracy).
3. **Payment gateway choice.** Razorpay is strongest for Indian retainer collection; Cashfree is cheaper per transaction. Pick one for Phase 1 or support both?
4. **Copilot model.** `XF-NEW-17` works with Claude, GPT-4, or Gemini. Which per-request budget? Which model's refusal behaviour do we trust for finance questions?
5. **MSME compliance scope.** `N5-NEW-04` is the biggest Phase 2 bet. Do we charge a premium for the compliance module or bundle it to win Indian mid-market?

---

**Document end.** Change-control to begin after sign-off from Super Admin and Finance Lead. All requirement IDs trace to v1.8 numbering where applicable or to this document's NEW IDs. The 137-feature benchmark that informed this PRD is referenced as `TapCRM_Finance_Benchmark.pdf` (26 October 2026).
