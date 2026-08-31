# TapCRM — Authorization

**Version** 1.8 **Status** Converted from `TapCRM_AUTHORIZATION_v1.8.pdf`

> **This file is generated.** `tools/convert-authorization-pdf.py` lifted §6.4 and
> §6.5 out of the delivered PDF into the markdown tables below, so that
> `tools/extract-registry.ts` can consume them (TECH.md §6.1). The conversion
> asserts every total the document states about itself — 147 actions,
> 292 bindings, and the sensitive / approval-bearing / delegable /
> domain counts — and refuses to write this file if any of them disagree.
>
> The PDF remains the human-authoritative document. Prose sections §1–§5 and
> §7–§11 live there and are not reproduced here; only the two machine-read
> tables are.

---

## 6.4 Action Registry

147 actions. Column meanings are as given in the source document:

| Column | Meaning |
| --- | --- |
| `Resource` | Which `ResourcePolicy` governs object-level checks and list filtering. `—` means the action operates on no object — configuration or a derived report — and is gated by policy alone. |
| `Domain` | `people` \| `business`. A `derived` resource resolves to one of these two at evaluation time; `derived` is a declaration style, not a third domain. |
| `Sensitive` | Every **use** is written to the access audit, not only every grant. |
| `ApprovalBearing` | Segregation of duties (A1) applies and an initiator field is mandatory. |
| `InitiatorField` | The field naming who initiated the item, resolved per §4.1.1. |
| `PositionGrantable` | May appear in a Position's policy list. |
| `DelegationAllowed` | A delegate may grant it, bounded by the ceiling. |
| `SuperAdminOnly` | Only Super Admin may grant it. |

**Registry invariants** (asserted at build time by the extractor, RG-I4):

| # | Invariant |
| --- | --- |
| RG-1 | `DelegationAllowed` requires `Sensitive = no`. A sensitive action is never delegable — a delegate may hold it, but only Super Admin may hand it out. |
| RG-2 | `SuperAdminOnly` implies `DelegationAllowed = no` (GP-2). |
| RG-3 | `PositionGrantable = no` implies `DelegationAllowed = no` and `SuperAdminOnly = yes` (GP-1). Two actions qualify: `notepad:view-all` and `billing:set-terms`. |
| RG-4 | `ApprovalBearing` requires a non-null initiator field (GP-5). |
| RG-5 | Every action names a resource or is explicitly `—`. There is no unspecified case. |
| RG-6 | Every action has at least one API binding (§6.5). |

| Action | Module | Resource | Domain | Sensitive | ApprovalBearing | InitiatorField | PositionGrantable | DelegationAllowed | SuperAdminOnly |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `identity:manage-geofence` | identity | geofenceLocation | people | yes | no | — | yes | no | no |
| `identity:unlock-account` | identity | user | people | yes | no | — | yes | no | no |
| `org:view-structure` | organization | department | business | no | no | — | yes | yes | no |
| `org:view-people` | organization | user | people | no | no | — | yes | yes | no |
| `org:view-policies` | organization | position | business | yes | no | — | yes | no | no |
| `org:manage-departments` | organization | department | business | yes | no | — | yes | no | yes |
| `org:manage-teams` | organization | team | business | yes | no | — | yes | no | no |
| `org:manage-positions` | organization | position | business | yes | no | — | yes | no | yes |
| `org:manage-designations` | organization | designation | business | no | no | — | yes | yes | no |
| `access:view` | access-management | user | people | no | no | — | yes | yes | no |
| `access:delegate` | access-management | user | people | yes | no | — | yes | no | yes |
| `access:request-role-change` | access-management | roleChangeRequest | business | no | no | — | yes | yes | no |
| `access:decide-role-change` | access-management | roleChangeRequest | business | yes | yes | requestedBy | yes | no | yes |
| `audit:view` | audit | auditEntry | derived | yes | no | — | yes | no | no |
| `audit:export` | audit | auditEntry | derived | yes | no | — | yes | no | yes |
| `audit:manage-holds` | audit | legalHold | derived | yes | no | — | yes | no | yes |
| `system:manage-settings` | system-administration | — | business | yes | no | — | yes | no | yes |
| `system:manage-thresholds` | system-administration | — | business | yes | no | — | yes | no | yes |
| `system:manage-integrations` | system-administration | — | business | yes | no | — | yes | no | yes |
| `system:manage-retention` | system-administration | — | business | yes | no | — | yes | no | yes |
| `users:view` | employee-directory | user | people | no | no | — | yes | yes | no |
| `users:manage` | employee-directory | user | people | yes | no | — | yes | no | yes |
| `onboarding:manage` | onboarding | onboardingWorkflow | people | no | no | — | yes | yes | no |
| `attendance:view-live` | attendance | userStatus | people | no | no | — | yes | yes | no |
| `attendance:view` | attendance | attendanceRecord | people | no | no | — | yes | yes | no |
| `attendance:export` | attendance | attendanceRecord | people | no | no | — | yes | yes | no |
| `attendance:correct` | attendance | attendanceCorrection | people | yes | yes | requestedBy | yes | no | no |
| `attendance:request-correction` | attendance | attendanceCorrection | people | no | no | — | yes | yes | no |
| `breaks:manage-policy` | break-management | breakPolicy | people | yes | no | — | yes | no | no |
| `breaks:review-breach` | break-management | breakBreach | people | yes | yes | userId | yes | no | no |
| `breaks:view` | break-management | breakBreach | people | no | no | — | yes | yes | no |
| `shifts:view` | shifts | shift | people | no | no | — | yes | yes | no |
| `shifts:manage` | shifts | shift | people | no | no | — | yes | yes | no |
| `shifts:approve` | shifts | shiftRequest | people | no | yes | requestedBy | yes | yes | no |
| `biometric:manage` | biometric | biometricDevice | people | yes | no | — | yes | no | no |
| `leave:view` | leave | leaveRequest | people | no | no | — | yes | yes | no |
| `leave:request` | leave | leaveRequest | people | no | no | — | yes | yes | no |
| `leave:request-wfh` | leave | leaveRequest | people | no | no | — | yes | yes | no |
| `leave:manage-wfh-standing` | leave | leaveRequest | people | no | no | — | yes | yes | no |
| `leave:acknowledge` | leave | leaveRequest | people | no | yes | requestedBy | yes | yes | no |
| `leave:decide` | leave | leaveRequest | people | yes | yes | requestedBy | yes | no | no |
| `leave:manage-types` | leave | leaveType | people | no | no | — | yes | yes | no |
| `holidays:view` | holidays | holiday | people | no | no | — | yes | yes | no |
| `holidays:manage` | holidays | holiday | people | no | no | — | yes | yes | no |
| `payroll:view` | payroll | payslip | people | yes | no | — | yes | no | no |
| `payroll:manage` | payroll | payrollRun | people | yes | no | — | yes | no | yes |
| `payroll:manage-config` | payroll | payrollConfig | people | yes | no | — | yes | no | yes |
| `performance:view` | performance | performanceRecord | people | no | no | — | yes | yes | no |
| `performance:view-aggregates` | performance | performanceRecord | people | no | no | — | yes | yes | no |
| `performance:manage` | performance | performanceRecord | people | yes | yes | subjectId | yes | no | no |
| `territories:view` | territories | territory | business | no | no | — | yes | yes | no |
| `territories:manage` | territories | territory | business | no | no | — | yes | yes | no |
| `leads:view` | leads | lead | business | no | no | — | yes | yes | no |
| `leads:create` | leads | lead | business | no | no | — | yes | yes | no |
| `leads:edit` | leads | lead | business | no | no | — | yes | yes | no |
| `leads:reassign` | leads | lead | business | no | no | — | yes | yes | no |
| `callbacks:view` | callbacks | callback | business | no | no | — | yes | yes | no |
| `callbacks:create` | callbacks | callback | business | no | no | — | yes | yes | no |
| `callbacks:edit` | callbacks | callback | business | no | no | — | yes | yes | no |
| `handovers:initiate` | handovers | handover | business | no | no | — | yes | yes | no |
| `handovers:receive` | handovers | handover | business | no | no | — | yes | yes | no |
| `handovers:record-disposition` | handovers | handover | business | no | no | — | yes | yes | no |
| `handovers:view` | handovers | handover | business | no | no | — | yes | yes | no |
| `deals:view` | deals | deal | business | no | no | — | yes | yes | no |
| `deals:view-commercials` | deals | deal | business | yes | no | — | yes | no | no |
| `deals:create` | deals | deal | business | no | no | — | yes | yes | no |
| `deals:edit` | deals | deal | business | no | no | — | yes | yes | no |
| `deals:approve` | deals | deal | business | yes | yes | createdBy | yes | no | no |
| `deals:allow-custom-terms` | deals | deal | business | yes | no | — | yes | no | no |
| `deals:approve-contract` | deals | deal | business | yes | yes | createdBy | yes | no | no |
| `deals:confirm-payment` | deals | deal | business | yes | yes | payment.initiatedBy | yes | no | no |
| `deals:record-win` | deals | deal | business | yes | yes | closedBy | yes | no | no |
| `deals:forecast` | deals | deal | business | no | no | — | yes | yes | no |
| `approvals:decide` | approvals | approvalRequest | business | yes | yes | requestedBy | yes | no | no |
| `approvals:delegate` | approvals | approvalDelegation | business | yes | no | — | yes | no | no |
| `handoff:create` | handoff | projectBrief | business | no | no | — | yes | yes | no |
| `handoff:confirm` | handoff | projectBrief | business | yes | yes | createdBy | yes | no | no |
| `handoff:review` | handoff | projectBrief | business | yes | yes | confirmedBy | yes | no | no |
| `handoff:view` | handoff | projectBrief | business | no | no | — | yes | yes | no |
| `projects:view` | projects | project | business | no | no | — | yes | yes | no |
| `projects:manage` | projects | project | business | no | no | — | yes | yes | no |
| `projects:view-financials` | projects | project | business | yes | no | — | yes | no | no |
| `tasks:view` | tasks | task | business | no | no | — | yes | yes | no |
| `tasks:assign` | tasks | task | business | no | no | — | yes | yes | no |
| `tasks:update` | tasks | task | business | no | no | — | yes | yes | no |
| `tasks:review` | tasks | task | business | no | yes | assignedTo | yes | yes | no |
| `tasks:manage-dependencies` | tasks | task | business | no | no | — | yes | yes | no |
| `tasks:log-time` | tasks | timeEntry | business | no | no | — | yes | yes | no |
| `resources:view` | resource-planning | allocation | business | no | no | — | yes | yes | no |
| `resources:allocate` | resource-planning | allocation | business | no | no | — | yes | yes | no |
| `resources:override-allocation` | resource-planning | allocation | business | yes | no | — | yes | no | no |
| `delivery:view` | delivery | delivery | business | no | no | — | yes | yes | no |
| `delivery:approve` | delivery | delivery | business | yes | no | — | yes | no | no |
| `delivery:share` | delivery | delivery | business | no | no | — | yes | yes | no |
| `delivery:signoff` | delivery | delivery | business | yes | yes | deliveredBy | yes | no | no |
| `changes:classify` | delivery | changeRequest | business | yes | yes | raisedBy | yes | no | no |
| `changes:assign` | delivery | changeRequest | business | no | no | — | yes | yes | no |
| `billing:view-terms` | billing-terms | billingTerms | business | yes | no | — | yes | no | no |
| `billing:set-terms` | billing-terms | billingTerms | business | yes | no | — | no | no | yes |
| `invoicing:view` | invoicing | invoice | business | no | no | — | yes | yes | no |
| `invoicing:create` | invoicing | invoice | business | no | no | — | yes | yes | no |
| `invoicing:issue` | invoicing | invoice | business | yes | yes | createdBy | yes | no | no |
| `invoicing:send` | invoicing | invoice | business | no | no | — | yes | yes | no |
| `invoicing:credit-note` | invoicing | creditNote | business | yes | no | — | yes | no | no |
| `invoicing:manage-recurring` | invoicing | recurringSchedule | business | no | no | — | yes | yes | no |
| `invoicing:manage-series` | invoicing | numberSeries | business | yes | no | — | yes | no | yes |
| `payments:view` | payments | receipt | business | no | no | — | yes | yes | no |
| `payments:record` | payments | receipt | business | no | no | — | yes | yes | no |
| `payments:allocate` | payments | receipt | business | no | no | — | yes | yes | no |
| `payments:refund` | payments | refund | business | yes | yes | requestedBy | yes | no | no |
| `payments:reconcile` | payments | bankReconciliation | business | yes | yes | recordedBy | yes | no | no |
| `receivables:view` | receivables | invoice | business | no | no | — | yes | yes | no |
| `receivables:dun` | receivables | invoice | business | no | no | — | yes | yes | no |
| `receivables:write-off` | receivables | invoice | business | yes | yes | proposedBy | yes | no | no |
| `payables:view` | payables | vendorBill | business | no | no | — | yes | yes | no |
| `payables:create-bill` | payables | vendorBill | business | no | no | — | yes | yes | no |
| `payables:approve-bill` | payables | vendorBill | business | yes | yes | createdBy | yes | no | no |
| `payables:claim` | payables | expenseClaim | people | no | no | — | yes | yes | no |
| `payables:approve-claim` | payables | expenseClaim | people | no | yes | claimedBy | yes | yes | no |
| `payables:execute-run` | payables | paymentRun | business | yes | yes | approvedBy | yes | no | no |
| `accounting:view-ledger` | accounting | journalEntry | business | yes | no | — | yes | no | no |
| `accounting:post-journal` | accounting | journalEntry | business | yes | no | — | yes | no | no |
| `accounting:manage-accounts` | accounting | ledgerAccount | business | yes | no | — | yes | no | no |
| `accounting:close-period` | accounting | accountingPeriod | business | yes | yes | lastPostedBy | yes | no | no |
| `accounting:reopen-period` | accounting | accountingPeriod | business | yes | no | — | yes | no | yes |
| `accounting:view-statements` | accounting | — | business | yes | no | — | yes | no | no |
| `accounting:tax-export` | accounting | — | business | yes | no | — | yes | no | no |
| `clients:view` | clients | client | business | no | no | — | yes | yes | no |
| `clients:manage` | clients | client | business | yes | no | — | yes | no | no |
| `clients:manage-requests` | clients | clientRequest | business | no | no | — | yes | yes | no |
| `accounts:manage-ownership` | clients | account | business | yes | no | — | yes | no | no |
| `accounts:view-revenue` | clients | account | business | yes | no | — | yes | no | no |
| `renewals:view` | post-closure | renewalOpportunity | business | no | no | — | yes | yes | no |
| `communication:view` | project-communication | message | derived | no | no | — | yes | yes | no |
| `communication:client-thread` | project-communication | message | derived | no | no | — | yes | yes | no |
| `documents:view` | documents | document | derived | no | no | — | yes | yes | no |
| `documents:upload` | documents | document | derived | no | no | — | yes | yes | no |
| `documents:share-client` | documents | document | derived | yes | no | — | yes | no | no |
| `documents:manage-templates` | documents | documentTemplate | business | no | no | — | yes | yes | no |
| `reports:view` | reporting | — | business | no | no | — | yes | yes | no |
| `reports:build` | reporting | — | business | no | no | — | yes | yes | no |
| `reports:export` | reporting | — | business | yes | no | — | yes | no | no |
| `reports:view-financial` | reporting | — | business | yes | no | — | yes | no | no |
| `reports:view-lifecycle` | reporting | — | business | yes | no | — | yes | no | yes |
| `notices:manage` | workspace | notice | business | no | no | — | yes | yes | no |
| `notepad:view-all` | workspace | notepad | people | yes | no | — | no | no | yes |
| `sheets:manage` | workspace | sheet | business | no | no | — | yes | yes | no |

---

## 6.5 API Bindings

292 bindings. Every action bound to at least one HTTP route. A route
registered at boot with no binding is a startup failure (RM-1); a binding naming
an unregistered action fails the build (RM-2).

Paths are the design intent. `TECH.md` may refine them, but **not** the
method-to-action mapping — that is the authorization contract, and changing it
changes who can do what.

| Method | Path | Action | ResourceParam |
| --- | --- | --- | --- |
| GET | /api/identity/geofences | `identity:manage-geofence` | — |
| POST | /api/identity/geofences | `identity:manage-geofence` | — |
| PATCH | /api/identity/geofences/:id | `identity:manage-geofence` | id |
| POST | /api/identity/geofences/:id/assign | `identity:manage-geofence` | id |
| POST | /api/identity/users/:id/unlock | `identity:unlock-account` | id |
| GET | /api/org/departments | `org:view-structure` | — |
| GET | /api/org/teams | `org:view-structure` | — |
| GET | /api/org/ladder/:departmentCode | `org:view-structure` | — |
| GET | /api/org/chart | `org:view-people` | — |
| GET | /api/org/positions/:id/holders | `org:view-people` | id |
| GET | /api/org/positions/:id/policies | `org:view-policies` | id |
| GET | /api/org/positions/:id/policy-preview | `org:manage-positions` | id |
| DELETE | /api/org/positions/:id | `org:manage-positions` | id |
| PATCH | /api/org/designations/:id | `org:manage-designations` | id |
| DELETE | /api/org/designations/:id | `org:manage-designations` | id |
| POST | /api/org/positions/:id/policy-preview | `org:manage-positions` | id |
| POST | /api/org/departments | `org:manage-departments` | — |
| PATCH | /api/org/departments/:id | `org:manage-departments` | id |
| DELETE | /api/org/departments/:id | `org:manage-departments` | id |
| POST | /api/org/teams | `org:manage-teams` | — |
| PATCH | /api/org/teams/:id | `org:manage-teams` | id |
| POST | /api/org/teams/:id/members | `org:manage-teams` | id |
| POST | /api/org/positions | `org:manage-positions` | — |
| PATCH | /api/org/positions/:id | `org:manage-positions` | id |
| PUT | /api/org/positions/:id/policies | `org:manage-positions` | id |
| GET | /api/org/designations | `org:manage-designations` | — |
| POST | /api/org/designations | `org:manage-designations` | — |
| GET | /api/access/effective/:userId | `access:view` | userId |
| GET | /api/access/who-can/:action | `access:view` | — |
| POST | /api/access/override | `access:delegate` | — |
| DELETE | /api/access/override/:id | `access:delegate` | id |
| POST | /api/access/role-change-request | `access:request-role-change` | — |
| POST | /api/access/role-change-request/:id/decide | `access:decide-role-change` | id |
| GET | /api/audit | `audit:view` | — |
| GET | /api/audit/:id | `audit:view` | id |
| POST | /api/audit/export | `audit:export` | — |
| GET | /api/audit/holds | `audit:manage-holds` | — |
| POST | /api/audit/holds | `audit:manage-holds` | — |
| DELETE | /api/audit/holds/:id | `audit:manage-holds` | id |
| GET | /api/system/settings | `system:manage-settings` | — |
| PUT | /api/system/settings | `system:manage-settings` | — |
| PUT | /api/system/feature-flags | `system:manage-settings` | — |
| GET | /api/system/thresholds | `system:manage-thresholds` | — |
| PUT | /api/system/thresholds | `system:manage-thresholds` | — |
| GET | /api/system/integrations | `system:manage-integrations` | — |
| PUT | /api/system/integrations/:key | `system:manage-integrations` | key |
| GET | /api/system/retention | `system:manage-retention` | — |
| PUT | /api/system/retention | `system:manage-retention` | — |
| GET | /api/users | `users:view` | — |
| GET | /api/users/:id | `users:view` | id |
| POST | /api/users | `users:manage` | — |
| PATCH | /api/users/:id | `users:manage` | id |
| POST | /api/users/:id/status | `users:manage` | id |
| POST | /api/users/import | `users:manage` | — |
| GET | /api/onboarding | `onboarding:manage` | — |
| POST | /api/onboarding | `onboarding:manage` | — |
| POST | /api/onboarding/:id/steps/:stepId/complete | `onboarding:manage` | id |
| GET | /api/attendance/live | `attendance:view-live` | — |
| GET | /api/attendance | `attendance:view` | — |
| GET | /api/attendance/:userId/:date | `attendance:view` | userId |
| POST | /api/attendance/export | `attendance:export` | — |
| POST | /api/attendance/corrections | `attendance:correct` | — |
| POST | /api/attendance/corrections/:id/approve | `attendance:correct` | id |
| POST | /api/attendance/corrections/bulk | `attendance:correct` | — |
| POST | /api/attendance/corrections/request | `attendance:request-correction` | — |
| GET | /api/breaks/policies | `breaks:manage-policy` | — |
| POST | /api/breaks/policies | `breaks:manage-policy` | — |
| PATCH | /api/breaks/policies/:id | `breaks:manage-policy` | id |
| POST | /api/breaks/policies/:id/preview | `breaks:manage-policy` | id |
| POST | /api/breaks/policies/:id/assign | `breaks:manage-policy` | id |
| POST | /api/breaks/breaches/:id/confirm | `breaks:review-breach` | id |
| POST | /api/breaks/breaches/:id/waive | `breaks:review-breach` | id |
| GET | /api/breaks/breaches | `breaks:view` | — |
| GET | /api/breaks/allowance/me | `breaks:view` | — |
| GET | /api/breaks/policies/resolve/:userId | `breaks:view` | userId |
| GET | /api/shifts | `shifts:view` | — |
| GET | /api/shifts/assignments | `shifts:view` | — |
| POST | /api/shifts | `shifts:manage` | — |
| PATCH | /api/shifts/:id | `shifts:manage` | id |
| POST | /api/shifts/assignments | `shifts:manage` | — |
| POST | /api/shifts/requests/:id/decide | `shifts:approve` | id |
| GET | /api/biometric/devices | `biometric:manage` | — |
| POST | /api/biometric/devices | `biometric:manage` | — |
| PATCH | /api/biometric/devices/:serial | `biometric:manage` | serial |
| PUT | /api/biometric/mapping | `biometric:manage` | — |
| GET | /api/biometric/punches | `biometric:manage` | — |
| POST | /api/biometric/punches/replay | `biometric:manage` | — |
| GET | /api/leaves | `leave:view` | — |
| GET | /api/leaves/:id | `leave:view` | id |
| GET | /api/leaves/balances/:userId | `leave:view` | userId |
| GET | /api/leaves/calendar | `leave:view` | — |
| POST | /api/leaves | `leave:request` | — |
| DELETE | /api/leaves/:id | `leave:request` | id |
| POST | /api/leaves/wfh | `leave:request-wfh` | — |
| POST | /api/leaves/wfh/standing | `leave:manage-wfh-standing` | — |
| DELETE | /api/leaves/wfh/standing/:id | `leave:manage-wfh-standing` | id |
| POST | /api/leaves/:id/acknowledge | `leave:acknowledge` | id |
| POST | /api/leaves/:id/decide | `leave:decide` | id |
| GET | /api/leaves/types | `leave:manage-types` | — |
| POST | /api/leaves/types | `leave:manage-types` | — |
| PUT | /api/leaves/types/:id | `leave:manage-types` | id |
| GET | /api/holidays | `holidays:view` | — |
| POST | /api/holidays | `holidays:manage` | — |
| PATCH | /api/holidays/:id | `holidays:manage` | id |
| GET | /api/payroll/payslips/mine | `payroll:view` | — |
| GET | /api/payroll/payslips/:id | `payroll:view` | id |
| GET | /api/payroll/runs | `payroll:manage` | — |
| POST | /api/payroll/runs | `payroll:manage` | — |
| PATCH | /api/payroll/runs/:id | `payroll:manage` | id |
| POST | /api/payroll/runs/:id/publish | `payroll:manage` | id |
| POST | /api/payroll/payslips/:id/revise | `payroll:manage` | id |
| GET | /api/payroll/structures | `payroll:manage` | — |
| PUT | /api/payroll/structures/:userId | `payroll:manage` | userId |
| GET | /api/payroll/config | `payroll:manage-config` | — |
| PUT | /api/payroll/config | `payroll:manage-config` | — |
| GET | /api/performance/:userId | `performance:view` | userId |
| GET | /api/performance/:userId/kpis | `performance:view-aggregates` | userId |
| POST | /api/performance/:userId/reviews | `performance:manage` | userId |
| POST | /api/performance/cycles | `performance:manage` | — |
| GET | /api/territories | `territories:view` | — |
| POST | /api/territories | `territories:manage` | — |
| PATCH | /api/territories/:id | `territories:manage` | id |
| PUT | /api/territories/routing | `territories:manage` | — |
| GET | /api/leads | `leads:view` | — |
| GET | /api/leads/:id | `leads:view` | id |
| GET | /api/leads/unrouted | `leads:view` | — |
| POST | /api/leads | `leads:create` | — |
| POST | /api/leads/import | `leads:create` | — |
| PATCH | /api/leads/:id | `leads:edit` | id |
| POST | /api/leads/:id/reassign | `leads:reassign` | id |
| POST | /api/leads/bulk-reassign | `leads:reassign` | — |
| GET | /api/callbacks | `callbacks:view` | — |
| GET | /api/callbacks/:id | `callbacks:view` | id |
| POST | /api/callbacks | `callbacks:create` | — |
| PATCH | /api/callbacks/:id | `callbacks:edit` | id |
| POST | /api/callbacks/:id/outcome | `callbacks:edit` | id |
| POST | /api/handovers | `handovers:initiate` | — |
| GET | /api/handovers/targets | `handovers:initiate` | — |
| POST | /api/handovers/:id/accept | `handovers:receive` | id |
| POST | /api/handovers/:id/decline | `handovers:receive` | id |
| POST | /api/handovers/:id/disposition | `handovers:record-disposition` | id |
| GET | /api/handovers | `handovers:view` | — |
| GET | /api/handovers/:id | `handovers:view` | id |
| GET | /api/deals | `deals:view` | — |
| GET | /api/deals/:id | `deals:view` | id |
| GET | /api/deals/:id/commercials | `deals:view-commercials` | id |
| POST | /api/deals | `deals:create` | — |
| PATCH | /api/deals/:id | `deals:edit` | id |
| PATCH | /api/deals/:id/commercials | `deals:edit` | id |
| POST | /api/deals/:id/approve | `deals:approve` | id |
| POST | /api/deals/:id/custom-terms | `deals:allow-custom-terms` | id |
| POST | /api/deals/:id/contract/approve | `deals:approve-contract` | id |
| POST | /api/deals/:id/confirm-payment | `deals:confirm-payment` | id |
| POST | /api/deals/:id/record-win | `deals:record-win` | id |
| GET | /api/deals/wins-to-record | `deals:record-win` | — |
| GET | /api/deals/forecast | `deals:forecast` | — |
| GET | /api/approvals/queue | `approvals:decide` | — |
| POST | /api/approvals/:id/decide | `approvals:decide` | id |
| GET | /api/approvals/delegations | `approvals:delegate` | — |
| POST | /api/approvals/delegations | `approvals:delegate` | — |
| DELETE | /api/approvals/delegations/:id | `approvals:delegate` | id |
| POST | /api/handoff | `handoff:create` | — |
| POST | /api/handoff/:id/revise | `handoff:create` | id |
| GET | /api/handoff/pending-confirmation | `handoff:confirm` | — |
| POST | /api/handoff/:id/confirm | `handoff:confirm` | id |
| POST | /api/handoff/:id/query-back | `handoff:confirm` | id |
| GET | /api/handoff/feasibility-queue | `handoff:review` | — |
| POST | /api/handoff/:id/decide | `handoff:review` | id |
| GET | /api/handoff | `handoff:view` | — |
| GET | /api/handoff/:id | `handoff:view` | id |
| GET | /api/projects | `projects:view` | — |
| GET | /api/projects/:id | `projects:view` | id |
| POST | /api/projects | `projects:manage` | — |
| PATCH | /api/projects/:id | `projects:manage` | id |
| POST | /api/projects/:id/team | `projects:manage` | id |
| POST | /api/projects/:id/archive | `projects:manage` | id |
| GET | /api/projects/:id/profitability | `projects:view-financials` | id |
| GET | /api/tasks | `tasks:view` | — |
| GET | /api/tasks/:id | `tasks:view` | id |
| POST | /api/tasks | `tasks:assign` | — |
| POST | /api/tasks/:id/assign | `tasks:assign` | id |
| PATCH | /api/tasks/:id | `tasks:update` | id |
| POST | /api/tasks/:id/transition | `tasks:update` | id |
| POST | /api/tasks/:id/comments | `tasks:update` | id |
| POST | /api/tasks/:id/review | `tasks:review` | id |
| GET | /api/tasks/review-queue | `tasks:review` | — |
| POST | /api/tasks/:id/dependencies | `tasks:manage-dependencies` | id |
| DELETE | /api/tasks/:id/dependencies/:depId | `tasks:manage-dependencies` | id |
| POST | /api/tasks/:id/time | `tasks:log-time` | id |
| POST | /api/tasks/time/:entryId/approve | `tasks:log-time` | entryId |
| GET | /api/resources/capacity | `resources:view` | — |
| GET | /api/resources/workload | `resources:view` | — |
| POST | /api/resources/allocate | `resources:allocate` | — |
| POST | /api/resources/:assignmentId/override | `resources:override-allocation` | assignmentId |
| POST | /api/delivery/:projectId/deliver | `delivery:approve` | projectId |
| POST | /api/delivery/:id/share | `delivery:share` | id |
| GET | /api/delivery | `delivery:share` | — |
| GET | /api/delivery/:id | `delivery:view` | id |
| GET | /api/changes | `delivery:view` | — |
| POST | /api/delivery/:id/signoff | `delivery:signoff` | id |
| POST | /api/changes/:id/classify | `changes:classify` | id |
| GET | /api/changes | `changes:classify` | — |
| POST | /api/changes/:id/assign | `changes:assign` | id |
| GET | /api/billing/terms/:clientId | `billing:view-terms` | clientId |
| GET | /api/billing/rate-cards | `billing:view-terms` | — |
| PUT | /api/billing/terms/:clientId | `billing:set-terms` | clientId |
| POST | /api/billing/rate-cards | `billing:set-terms` | — |
| PATCH | /api/billing/rate-cards/:id | `billing:set-terms` | id |
| GET | /api/invoices | `invoicing:view` | — |
| GET | /api/invoices/:id | `invoicing:view` | id |
| POST | /api/invoices | `invoicing:create` | — |
| PATCH | /api/invoices/:id | `invoicing:create` | id |
| DELETE | /api/invoices/:id | `invoicing:create` | id |
| POST | /api/invoices/:id/issue | `invoicing:issue` | id |
| POST | /api/invoices/:id/send | `invoicing:send` | id |
| POST | /api/invoices/:id/credit-note | `invoicing:credit-note` | id |
| GET | /api/invoices/recurring | `invoicing:manage-recurring` | — |
| POST | /api/invoices/recurring | `invoicing:manage-recurring` | — |
| PATCH | /api/invoices/recurring/:id | `invoicing:manage-recurring` | id |
| GET | /api/invoices/series | `invoicing:manage-series` | — |
| POST | /api/invoices/series | `invoicing:manage-series` | — |
| GET | /api/payments | `payments:view` | — |
| GET | /api/payments/:id | `payments:view` | id |
| POST | /api/payments | `payments:record` | — |
| POST | /api/payments/:id/allocate | `payments:allocate` | id |
| POST | /api/payments/:id/refund | `payments:refund` | id |
| GET | /api/payments/reconciliation | `payments:reconcile` | — |
| POST | /api/payments/reconciliation/:id/match | `payments:reconcile` | id |
| GET | /api/receivables/aging | `receivables:view` | — |
| GET | /api/receivables/statement/:clientId | `receivables:view` | clientId |
| GET | /api/receivables/collections | `receivables:view` | — |
| GET | /api/receivables/tds | `receivables:view` | — |
| POST | /api/receivables/:invoiceId/dun | `receivables:dun` | invoiceId |
| PUT | /api/receivables/dunning-schedule | `receivables:dun` | — |
| POST | /api/receivables/:invoiceId/write- | `receivables:write-off` | invoiceId |
| GET | /api/payables/bills | `payables:view` | — |
| GET | /api/payables/bills/:id | `payables:view` | id |
| POST | /api/payables/bills | `payables:create-bill` | — |
| PATCH | /api/payables/bills/:id | `payables:create-bill` | id |
| POST | /api/payables/bills/:id/approve | `payables:approve-bill` | id |
| GET | /api/payables/claims/mine | `payables:claim` | — |
| POST | /api/payables/claims | `payables:claim` | — |
| POST | /api/payables/claims/:id/approve | `payables:approve-claim` | id |
| GET | /api/payables/runs | `payables:execute-run` | — |
| POST | /api/payables/runs | `payables:execute-run` | — |
| POST | /api/payables/runs/:id/execute | `payables:execute-run` | id |
| GET | /api/accounting/ledger | `accounting:view-ledger` | — |
| GET | /api/accounting/trial-balance | `accounting:view-ledger` | — |
| GET | /api/accounting/journals | `accounting:view-ledger` | — |
| POST | /api/accounting/journals | `accounting:post-journal` | — |
| POST | /api/accounting/journals/:id/reverse | `accounting:post-journal` | id |
| GET | /api/accounting/accounts | `accounting:manage-accounts` | — |
| POST | /api/accounting/accounts | `accounting:manage-accounts` | — |
| PATCH | /api/accounting/accounts/:id | `accounting:manage-accounts` | id |
| GET | /api/accounting/periods | `accounting:close-period` | — |
| POST | /api/accounting/periods/:id/close | `accounting:close-period` | id |
| POST | /api/accounting/periods/:id/reopen | `accounting:reopen-period` | id |
| GET | /api/accounting/statements/pnl | `accounting:view-statements` | — |
| GET | /api/accounting/statements/balance- | `accounting:view-statements` | — |
| GET | /api/accounting/statements/cash-flow | `accounting:view-statements` | — |
| POST | /api/accounting/tax/gstr1 | `accounting:tax-export` | — |
| POST | /api/accounting/tax/gstr3b | `accounting:tax-export` | — |
| POST | /api/accounting/tax/tds | `accounting:tax-export` | — |
| GET | /api/clients | `clients:view` | — |
| GET | /api/clients/:id | `clients:view` | id |
| POST | /api/clients | `clients:manage` | — |
| PATCH | /api/clients/:id | `clients:manage` | id |
| POST | /api/clients/:id/credentials | `clients:manage` | id |
| DELETE | /api/clients/:id/credentials | `clients:manage` | id |
| GET | /api/clients/requests | `clients:manage-requests` | — |
| POST | /api/clients/requests/:id/respond | `clients:manage-requests` | id |
| POST | /api/accounts/:clientId/ownership | `accounts:manage-ownership` | clientId |
| GET | /api/accounts/:clientId/revenue | `accounts:view-revenue` | clientId |
| GET | /api/renewals | `renewals:view` | — |
| GET | /api/communication/tracker | `communication:view` | — |
| GET | /api/projects/:id/messages/client | `communication:client-thread` | id |
| POST | /api/projects/:id/messages/client | `communication:client-thread` | id |
| GET | /api/documents | `documents:view` | — |
| GET | /api/documents/:id | `documents:view` | id |
| POST | /api/documents | `documents:upload` | — |
| POST | /api/documents/:id/versions | `documents:upload` | id |
| POST | /api/documents/:id/share | `documents:share-client` | id |
| GET | /api/documents/templates | `documents:manage-templates` | — |
| POST | /api/documents/templates | `documents:manage-templates` | — |
| GET | /api/reports | `reports:view` | — |
| GET | /api/reports/:key | `reports:view` | — |
| POST | /api/reports/custom | `reports:build` | — |
| POST | /api/reports/:key/export | `reports:export` | — |
| GET | /api/reports/financial/:key | `reports:view-financial` | — |
| GET | /api/reports/lifecycle | `reports:view-lifecycle` | — |
| GET | /api/notices | `notices:manage` | — |
| POST | /api/notices | `notices:manage` | — |
| PATCH | /api/notices/:id | `notices:manage` | id |
| GET | /api/workspace/notepads | `notepad:view-all` | — |
| GET | /api/workspace/notepads/:userId | `notepad:view-all` | userId |
| GET | /api/workspace/sheets | `sheets:manage` | — |
| POST | /api/workspace/sheets | `sheets:manage` | — |
| PATCH | /api/workspace/sheets/:id | `sheets:manage` | id |
