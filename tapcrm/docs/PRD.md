# TapCRM — Product Requirements Document

**Version** 1.9 **Status** Final product draft — implementation-ready; go-live remains blocked only by `DECISIONS.md` BD-2, BD-5, BD-27 and BD-28 **Date** 21 August 2026 **Owner** Tapvera Technologies

**Companion documents**

| Document Contains    |                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PRD.md` (this file) | Business requirements, org model, modules, workflows, acceptance criteria                                                                                                                                                                                                                                                                                                                                                   |
| `AUTHORIZATION.md`   | Permission policy architecture, scope resolution, vetoes, route manifest                                                                                                                                                                                                                                                                                                                                                    |
| `DECISIONS.md`       | Open business decisions, owners, and what each one blocks                                                                                                                                                                                                                                                                                                                                                                   |
| `TECH.md`            | Stack, data model, storage, infrastructure. Describes **how** the action registry is represented in code and configuration. It does **not** define the registry — that lives in `AUTHORIZATION.md` §6.4 and is authoritative. TECH.md must also map every Permission Matrix shorthand cell in §6 to its registry entry, so no implementer has to infer whether `dept*` means a scope, a capability or a read-only modifier. |
| `UI.md`              | Screen specifications and interaction detail *(to be written)*                                                                                                                                                                                                                                                                                                                                                              |
| `TEST_PLAN.md`       | Business rules mapped to automated tests *(to be written)*                                                                                                                                                                                                                                                                                                                                                                  |

This document states **what** the product does and **why**. It does not specify implementation. Where a requirement has an authorization dimension, it references `AUTHORIZATION.md` rather than restating the model.

---

## Table of Contents

1. [Product Overview](https://claude.ai/cowork/local_481ee0a7-4296-4ee0-ab13-4a47ff5b8edb#1-product-overview)
2. [Users and Access Categories](https://claude.ai/cowork/local_481ee0a7-4296-4ee0-ab13-4a47ff5b8edb#2-users-and-access-categories)
3. [Organizational Model](https://claude.ai/cowork/local_481ee0a7-4296-4ee0-ab13-4a47ff5b8edb#3-organizational-model)
4. [Authorization Model — Summary](https://claude.ai/cowork/local_481ee0a7-4296-4ee0-ab13-4a47ff5b8edb#4-authorization-model--summary)
5. [Module Catalog and Build Classification](https://claude.ai/cowork/local_481ee0a7-4296-4ee0-ab13-4a47ff5b8edb#5-module-catalog)
6. [Permission Matrix](https://claude.ai/cowork/local_481ee0a7-4296-4ee0-ab13-4a47ff5b8edb#6-permission-matrix)
7. [End-to-End Workflows](https://claude.ai/cowork/local_481ee0a7-4296-4ee0-ab13-4a47ff5b8edb#7-end-to-end-workflows)
8. [Module Specifications — Foundation](https://claude.ai/cowork/local_481ee0a7-4296-4ee0-ab13-4a47ff5b8edb#8-module-specifications--foundation)
9. [Module Specifications — People](https://claude.ai/cowork/local_481ee0a7-4296-4ee0-ab13-4a47ff5b8edb#9-module-specifications--people)
10. [Module Specifications — Sales](https://claude.ai/cowork/local_481ee0a7-4296-4ee0-ab13-4a47ff5b8edb#10-module-specifications--sales)
11. [Module Specifications — Delivery](https://claude.ai/cowork/local_481ee0a7-4296-4ee0-ab13-4a47ff5b8edb#11-module-specifications--delivery)
12. [Module Specifications — Client](https://claude.ai/cowork/local_481ee0a7-4296-4ee0-ab13-4a47ff5b8edb#12-module-specifications--client)
13. [Module Specifications — Finance](https://claude.ai/cowork/local_481ee0a7-4296-4ee0-ab13-4a47ff5b8edb#13-module-specifications--finance)
14. [Module Specifications — Cross-Cutting](https://claude.ai/cowork/local_481ee0a7-4296-4ee0-ab13-4a47ff5b8edb#14-module-specifications--cross-cutting)
15. [Non-Functional Requirements](https://claude.ai/cowork/local_481ee0a7-4296-4ee0-ab13-4a47ff5b8edb#15-non-functional-requirements)
16. [Security and Compliance](https://claude.ai/cowork/local_481ee0a7-4296-4ee0-ab13-4a47ff5b8edb#16-security-and-compliance)
17. [Scale Targets](https://claude.ai/cowork/local_481ee0a7-4296-4ee0-ab13-4a47ff5b8edb#17-scale-targets)
18. [Release Phasing](https://claude.ai/cowork/local_481ee0a7-4296-4ee0-ab13-4a47ff5b8edb#18-release-phasing)
19. [Acceptance Criteria](https://claude.ai/cowork/local_481ee0a7-4296-4ee0-ab13-4a47ff5b8edb#19-acceptance-criteria)
20. [Glossary](https://claude.ai/cowork/local_481ee0a7-4296-4ee0-ab13-4a47ff5b8edb#20-glossary)
21. [Appendix A — Screen Inventory](https://claude.ai/cowork/local_481ee0a7-4296-4ee0-ab13-4a47ff5b8edb#21-appendix-a--screen-inventory)
22. [Appendix B — Permission Action Reference](https://claude.ai/cowork/local_481ee0a7-4296-4ee0-ab13-4a47ff5b8edb#22-appendix-b--permission-action-reference)

---

## 1. Product Overview

### 1.1 What TapCRM Is

TapCRM is a role-based operating system for a services company. It connects three functions that normally run in separate tools and lose information at the seams:

- **Sales** — lead capture through to a signed, paid deal
- **Delivery** — project brief through to client sign-off and closure
- **People** — attendance, breaks, leave, payroll, and performance

The connecting idea is that a customer engagement is one continuous chain of custody. A lead becomes a deal, a deal becomes a project brief, a brief becomes a project, a project becomes a delivery, and a delivery becomes an account. Every transition in that chain is a record with an owner, a timestamp and a decision — not a conversation someone had.

### 1.2 The Problems It Solves

**Handoffs disappear.** Sales closes a deal and Development learns about it in a chat message. Nobody can say how long the handoff took, because there is no object whose age can be measured.

**Authority is informal.** Whether a discount needs approval depends on whether the person remembers to ask. The escalation ladder exists in people's heads.

**Visibility is all-or-nothing.** Either someone can see the whole pipeline or they see nothing, so access gets granted generously and quietly stops meaning anything.

**Attendance is measured but not governed.** Punches and breaks are recorded, but there is no policy attached to them and no consequence, so the data informs nothing.

**Reporting is manual.** Every question about performance is answered by someone building a spreadsheet.

### 1.3 Product Vision

The single system of record for how the company sells, delivers, and manages its people — giving every role exactly the visibility and control its job requires, and giving leadership a real-time view of the whole business.

### 1.4 Product Goals

| # Goal  |                                                                                                                                                                          |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| G1      | One organizational model — departments, teams, positions, reporting lines — as the only source of authority.                                                             |
| G2      | Every access decision resolved by one authorization engine with per-action scope. No permission logic scattered across handlers.                                         |
| G3      | A Super Admin can create a position, define what it can do and how far it reaches, staff it, and grant a named individual a documented exception — without a deployment. |
| G4      | Every workflow transition is gated by a record, so a stalled handoff is visible rather than discovered.                                                                  |
| G5      | Commercial authority is enforced by configured thresholds, not by convention.                                                                                            |
| G6      | People data and business data are separated by design, so HR can be broad across people without being broad across the business.                                         |
| G7      | Segregation of duties is a first-class control that no role, including Super Admin, can bypass.                                                                          |
| G8      | Leadership sees the whole chain — revenue, delivery timeline, team performance and client outcome — in one place.                                                        |

### 1.5 Success Metrics

| Metric Direction                                                         |                      |
| ------------------------------------------------------------------------ | -------------------- |
| Lead-to-close cycle time                                                 | Reduce               |
| Sales-to-Development handoff time (deal `won` → brief accepted)          | Reduce               |
| Deals closed outside the approval ladder                                 | Zero                 |
| On-time task and project delivery rate                                   | Increase             |
| Revision cycles per delivered project                                    | Reduce               |
| Attendance and payroll data accuracy                                     | Near 100%, automated |
| Time spent building manual reports                                       | Reduce               |
| Authorization violations (data visible to someone who should not see it) | Zero tolerance       |
| Median time a workflow item sits in a queue                              | Reduce, per stage    |

### 1.6 Explicit Non-Goals

- TapCRM is not a **standalone accounting product**. Its finance scope includes operational invoicing, receivables, payables and a general ledger sufficient to keep the product's own books and statutory outputs; it is not intended to replace a full enterprise accounting suite outside that scope.
- TapCRM is not a marketing automation platform. It records lead source and campaign attribution; it does not run campaigns.
- TapCRM is not a code repository or CI system. It tracks development tasks; it does not build software.

---

## 2. Users and Access Categories

Every principal in the system falls into exactly one of four account types. The account type is a coarse classification for authentication and routing; it grants no business permissions on its own.

| Account type Who Authority comes from  |                                                           |                                                         |
| -------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------- |
| `super-admin`                          | The system owner                                          | The account type itself. Root administrative principal. |
| `employee`                             | Everyone who works here, including all three branch heads | Their **Position**, entirely.                           |
| `client`                               | External customers                                        | Their project list. Never holds a Position.             |
| `service`                              | Integrations and automation                               | An explicitly scoped service policy (§2.2).             |

### 2.1 Super Admin Is Not a Position

Super Admin sits **outside** the organizational hierarchy as the root administrative principal. It is not modelled as a Position, does not appear in the reporting chain, and is not assignable to a department.

This matters because the hierarchy describes *the company* and Super Admin describes *the system*. Conflating them creates a phantom top node that every org chart, every reporting rollup and every scope calculation has to special-case.

Super Admin bypasses permission policy. It does **not** bypass segregation of duties or absolute constraints — see `AUTHORIZATION.md` §4.

### 2.2 Service Accounts

A service account has no position, no team, no department and no reporting line, so none of the scope machinery in §4 applies to it. It carries its own policy object instead.

```
ServiceAccount {
  name, description
  organizationId          // §17.1
  allowedActions   string[]   // explicit, no wildcards
  allowedResources string[]   // resource types it may touch
  recordFilter     ServiceFilter? // validated allow-listed narrowing DSL, e.g. one project
  ipAllowlist      string[]?
  expiresAt        datetime   // REQUIRED
  rateLimit        { perMinute, perDay }
  createdBy, createdAt, lastUsedAt
}

```

`ServiceFilter` is a small allow-listed predicate type over registered resource fields. It is validated against the action's resource schema and cannot contain arbitrary database operators, JavaScript expressions, server-side code, or tenant fields.

**Rules**

| # Rule  |                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SV-1    | A service account **never inherits a Position policy** and can never be assigned one. The two models do not mix.                                                                                                                                                                                                                                                                                      |
| SV-2    | `allowedActions` is an explicit list. Wildcards are not supported, because a wildcard silently acquires every action added later.                                                                                                                                                                                                                                                                     |
| SV-2b   | **`organizationId`** **is the tenant boundary and is not part of** **`recordFilter`****.** It is injected by the data-access layer from the credential before any narrowing filter is applied, and `recordFilter` cannot reference or override it. `recordFilter` is a validated allow-listed predicate DSL, not a raw database filter; operators that can execute arbitrary expressions or server-side code are forbidden. |
| SV-3    | Every service credential has a **mandatory expiry**, maximum 365 days. An unexpiring credential is a permanent unowned key.                                                                                                                                                                                                                                                                           |
| SV-4    | Service accounts are subject to every absolute constraint (A1–A4). A service account cannot approve a request it raised, cannot cross a client boundary, and cannot mutate an immutable record.                                                                                                                                                                                                       |
| SV-5    | Service accounts cannot hold `globalAccess`, `access:delegate`, `users:manage`, `payroll:manage` or `notepad:view-all`.                                                                                                                                                                                                                                                                               |
| SV-6    | Every service call is audited with the credential identity and source address.                                                                                                                                                                                                                                                                                                                        |
| SV-7    | Credentials are shown once at creation and never retrievable. Rotation issues a new credential with an overlap window.                                                                                                                                                                                                                                                                                |
| SV-8    | A service account with no activity for 90 days is flagged for review; at 180 days it is automatically disabled.                                                                                                                                                                                                                                                                                       |
| SV-9    | Service accounts appear in the access explorer alongside human principals. An integration's reach must be as visible as a person's.                                                                                                                                                                                                                                                                   |

### 2.3 Personas

| Persona Summary                                  |                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Super Admin                                      | Configures org structure, permissions, thresholds and system settings. Reviews weekly and monthly; intervenes on exception.                                                                                                                                                                                                    |
| HR                                               | Manages the employee lifecycle across every department — attendance, breaks, leave, payroll, performance. No business data.                                                                                                                                                                                                    |
| HR Executive                                     | Executes HR operations: data entry, onboarding steps, attendance logging. No payroll, no final approvals.                                                                                                                                                                                                                      |
| Sales Department Head                            | Accountable for the sales pipeline end to end — Team Leads, Supervisors, Agents, approval authority, contract sign-off, win confirmation. Holds `department` scope across Sales; is **not** the record owner of individual leads or deals.                                                                                     |
| Project Manager                                  | Owns a portfolio of clients and projects **after onboarding**. Confirms the brief, owns client communication, directs the work on their own projects through the dotted line (§3.7.1), obtains sign-off, classifies change requests, holds the account. **No sales authority.** No people authority over the team they direct. |
| Development Department Head                      | Owns all three delivery sub-teams, feasibility, resource allocation and delivery approval.                                                                                                                                                                                                                                     |
| Sales Team Lead                                  | Manages several Supervisors and their agent pools; approves mid-level discounts and custom terms.                                                                                                                                                                                                                              |
| Sales Supervisor                                 | Manages one agent pool; first escalation point; approves small discounts.                                                                                                                                                                                                                                                      |
| Sales Agent                                      | Frontline. Owns individual leads, works callbacks, hands live calls upward, owns the account after closure.                                                                                                                                                                                                                    |
| Developer Team Manager                           | Assigns and reviews development tasks.                                                                                                                                                                                                                                                                                         |
| Digital & Marketing Manager                      | Assigns and reviews marketing work; owns inbound lead generation.                                                                                                                                                                                                                                                              |
| Content Team Manager                             | Assigns and reviews content deliverables.                                                                                                                                                                                                                                                                                      |
| Developer / Marketing Executive / Content Writer | Executes assigned tasks through the task lifecycle.                                                                                                                                                                                                                                                                            |
| Finance Manager *(optional)*                     | Owns invoicing, receivables, payables and the ledger. Cannot set what a client pays.                                                                                                                                                                                                                                           |
| Accountant *(optional)*                          | Raises invoices, records receipts and vendor bills, posts journals. Cannot approve write-offs or close a period.                                                                                                                                                                                                               |
| Client                                           | Views their own projects and invoices, sees what is paid and what is outstanding, signs off deliveries, raises requests.                                                                                                                                                                                                       |

---

## 3. Organizational Model

### 3.1 Structure

Five functions report directly to Super Admin. HR and Finance are parallel support functions serving all departments. Sales and Development are branches with their own management chains. Project Managers are individual contributors at branch level: each owns a set of clients and projects, with no chain beneath them.

**Sales and project delivery are separate functions.** The Sales Department Head owns the pipeline — Team Leads, Supervisors and Agents — through to a confirmed win. A Project Manager owns the client relationship and the project **after onboarding**. Neither reports to the other, which is what allows a Project Manager to push back on scope Sales agreed to without that conversation running through their own manager.

**Delivery runs on two lines.** Organizationally the Development Department Head reports to Super Admin and owns the department's capacity, hiring and standards. Per project, they and their sub-teams are accountable to **the Project Manager who owns that project**: the PM assigns work, sets deadlines and re-prioritises within their own projects. The Development Department Head retains a **capacity veto** (§3.7.1) — they cannot be told to deliver more than the department has people for.

This is a matrix, and matrices fail when nobody says which line wins. Here it is explicit: **the Project Manager decides** ***what*** **and** ***when*** **on their own project; the Development Department Head decides** ***whether the department can absorb it*** **and** ***who*** **is available to do it.**

```
                                SUPER ADMIN
          +----------+-------------+-------------+-------------+
          |          |             |             |             |
         HR    SALES DEPT      PROJECT      DEVELOPMENT    FINANCE
          |        HEAD        MANAGERS      DEPT HEAD    (inactive)
          |          |          (several)         |            |
  HR Executive/  Sales Team        │        +-----+-----+   Accountant
  HR Assistant    Lead             │        |     |     |
  (serves all      │               │      Dev   Digital Content
   departments)  Sales             │      Team  & Mktg   Team
                 Supervisor        │       Mgr    Mgr     Mgr
                   │               │        |      |       |
                 Sales Agent       │     Developer Mktg  Content
                                   │              Exec   Writer
                                   │
                    owns projects and clients
                    AFTER onboarding; directs the
                    work on their own projects
                    across the three sub-teams

```

```
   SOLID LINE (organizational)          DOTTED LINE (per project)

   Dev Dept Head ──► Super Admin        Dev Dept Head ┐
                                        Sub-team Mgrs ├─► the Project Manager
                                        Developers    ┘   who owns that project

```

### 3.2 Departments

| Code Name Head Kind Status at launch  |                  |                                      |          |                        |
| ------------------------------------- | ---------------- | ------------------------------------ | -------- | ---------------------- |
| `hr`                                  | Human Resources  | HR                                   | Support  | Active                 |
| `sales`                               | Sales            | Sales Department Head                | Delivery | Active                 |
| `projects`                            | Project Delivery | *(none — PMs report to Super Admin)* | Delivery | Active                 |
| `development`                         | Development      | Development Department Head          | Delivery | Active                 |
| `finance`                             | Finance          | Finance Manager                      | Support  | **Inactive** — see D-6 |

**Rules**

- **D-1** `Department.code` is immutable. Renaming changes the display name only.
- **D-2** A department with any active Position or User cannot be deleted. It may be deactivated, which removes it from assignment while preserving history.
- **D-3** Development contains three **sub-teams**, each a first-class unit with its own manager and its own data boundary: Developer Team, Digital & Marketing, Content Team.
- **D-4** Sales contains one or more **teams**, each owned by a Sales Team Lead and organized by region, vertical or product line. Each team contains one or more **pools**, each owned by a Supervisor.
- **D-5** The `projects` department holds the Project Manager position. It has no head: every Project Manager reports directly to Super Admin and owns their own portfolio. If the company later grows enough to need a Head of Projects, that is a custom position inserted above them (§3.8 C-5), not a restructure.
- **D-6** Finance ships **inactive**. The department and its two positions exist in the ladder so that staffing finance later is an activation rather than a schema change, but nobody holds them at launch. Until Finance is staffed, Super Admin holds every finance capability and grants individual actions — typically `invoicing:create` — to named people through Access Management. Activating the department is a configuration change requiring no deployment.

### 3.3 Positions

Sixteen seeded positions, of which two — the Finance pair — ship inactive. `organizationalLevel` is an organizational attribute used by delegation and approval policy. **It is not an authorization grant** — see §4.3.

#### Human Resources

| Position Level Reports to  |    |             |
| -------------------------- | -- | ----------- |
| HR                         | 90 | Super Admin |
| HR Executive / Assistant   | 40 | HR          |

HR is deliberately two levels. The role has a broad domain and a shallow ladder; inventing intermediate tiers creates approval hops with no decision in them.

#### Sales

| Position Level Reports to  |    |                       |
| -------------------------- | -- | --------------------- |
| Sales Department Head      | 90 | Super Admin           |
| Sales Team Lead            | 70 | Sales Department Head |
| Sales Supervisor           | 50 | Sales Team Lead       |
| Sales Agent                | 20 | Sales Supervisor      |

The Sales Department Head owns the pipeline end to end: Team Leads, Supervisors, Agents, approval authority above a Team Lead's limit, contract and payment sign-off, and win confirmation. Their world ends at a confirmed win.

#### Project Delivery

| Position Level Reports to  |    |             |
| -------------------------- | -- | ----------- |
| Project Manager            | 80 | Super Admin |

Several Project Managers, each owning a portfolio of clients and projects, none reporting to another. A Project Manager's world **starts** at a confirmed win and runs to closure: confirming the brief, owning the client relationship, coordinating delivery through the Development Department Head, sharing deliverables for sign-off, classifying change requests, and holding the account afterwards.

**A Project Manager has no sales authority.** No leads, no callbacks, no handovers, no deal approval, no pipeline visibility. They read the deal that produced their project and nothing else in Sales.

**A Project Manager directs delivery on their own projects, through the dotted line (§3.7.1).** They assign tasks, set deadlines and re-prioritise within projects they own. They do **not** own the department: the Development Department Head holds the capacity veto, sub-team managers still review the work, and a PM has no authority over any project but their own.

Level 80 rather than 90 because a Project Manager manages no one on the solid line. The level expresses seniority for approval routing and delegation, not influence, and it sits below the branch heads by design: a Project Manager who outranked the Development Department Head could delegate access into a department whose people they do not manage.

#### Finance — optional, inactive at launch

| Position Level Reports to Status  |    |                 |          |
| --------------------------------- | -- | --------------- | -------- |
| Finance Manager                   | 90 | Super Admin     | Inactive |
| Accountant                        | 40 | Finance Manager | Inactive |

Finance is a fourth branch reporting to Super Admin, structurally identical to HR. It is seeded but unstaffed. A company without a finance hire runs the module through Super Admin plus granted individuals; a company that hires one activates the position and assigns them.

**Neither position can set what a client pays.** That is protected constraint P8 and belongs to Super Admin permanently, whether or not Finance is staffed.

#### Development

| Position Level Reports to   |    |                             |
| --------------------------- | -- | --------------------------- |
| Development Department Head | 90 | Super Admin                 |
| Developer Team Manager      | 65 | Development Department Head |
| Digital & Marketing Manager | 65 | Development Department Head |
| Content Team Manager        | 65 | Development Department Head |
| Developer                   | 25 | Developer Team Manager      |
| Marketing Executive         | 25 | Digital & Marketing Manager |
| Content Writer              | 25 | Content Team Manager        |

The three sub-team managers are peers at the same level with no authority over each other and disjoint data boundaries. Only the Department Head sees across all three.

**Level bands** — reserved so future insertions do not require renumbering.

| Band Use  |                                       |
| --------- | ------------------------------------- |
| 85–95     | Branch heads reporting to Super Admin |
| 60–80     | Second-line management                |
| 40–59     | First-line management                 |
| 10–39     | Individual contributors               |
| 1–9       | Interns and trainees                  |

### 3.4 Designation and Specialization

Two separate fields, because they answer different questions and are used by different consumers.

| Field Answers Example Used by  |                                         |                                |                                            |
| ------------------------------ | --------------------------------------- | ------------------------------ | ------------------------------------------ |
| `designation`                  | What is this person's job title?        | Developer, Marketing Executive | HR, payroll, letters, directory            |
| `specialization`               | What kind of work do they do within it? | Full-stack, SEO, Blog          | Task routing, capacity planning, reporting |

**Seeded specializations**

| Designation Specializations  |                                            |
| ---------------------------- | ------------------------------------------ |
| Developer                    | Frontend, Backend, Full-stack, QA / Tester |
| Marketing Executive          | SEO, Ads / PPC, Social Media, Analytics    |
| Content Writer               | Web Copy, Blog, Technical, Ad Copy         |

**Rules**

- **P-1** Neither field authorizes anything. Both are attributes.
- **P-2** Specializations are configuration. Adding one does not require a deployment or a new Position.
- **P-3** Specialization drives task-assignment suggestions and capacity reporting, never access.

### 3.5 Teams

A **Team** is the organizational unit that bounds lateral visibility. Without it, every Sales Team Lead sees every other Team Lead's agents, and every sub-team manager sees all three sub-teams.

| Field Purpose      |                                                           |
| ------------------ | --------------------------------------------------------- |
| `kind`             | `sales-team` \| `sales-pool` \| `dev-subteam`             |
| `departmentRef`    | Owning department                                         |
| `leadUser`         | The Team Lead, Supervisor or sub-team Manager who owns it |
| `parentTeam`       | A pool's parent sales-team; null otherwise                |
| `sharedVisibility` | Whether members can see each other's work (default false) |

**Rules**

- **T-1** Sales nests two levels: a Team Lead owns a `sales-team`; each of their Supervisors owns a `sales-pool` whose parent is that team.
- **T-2** Development has exactly three `dev-subteam` units. They do not nest.
- **T-3** `teamRef` on a User is **organizational ownership** — which manager's boundary this person sits inside. It is **not** project membership. A developer belongs to the Developer Team and may be assigned to six projects; those are different relationships and must never be conflated.
- **T-4** A user belongs to exactly one organizational team. Cross-functional collaboration is expressed through project assignment (§11.2), not through multiple team memberships.
- **T-5** Moving a user between teams changes their data boundary immediately and is audited.

### 3.5.1 Worked Example — Sales Visibility

The structure below is the reference case that `pool`, `team` and `department` scope are specified against.

```
                          SALES DEPARTMENT HEAD
                        ┌────────────┴────────────┐
                   TEAM LEAD A                TEAM LEAD B
                        │              ┌───────────┴───────────┐
                   Manish            Mukesh                 Anand
                  (Supervisor)     (Supervisor)          (Supervisor)
                    ┌───┴───┐        ┌───┴───┐            ┌───┴───┐
                  Ram   Shyaam    Jodhu   Modhu        Rohit   Rohan

```

**Who sees whose leads, callbacks and deals**

| Principal Scope Sees the records of  |              |                                           |
| ------------------------------------ | ------------ | ----------------------------------------- |
| Ram                                  | `own`        | Ram                                       |
| Manish                               | `pool`       | Manish, Ram, Shyaam                       |
| Mukesh                               | `pool`       | Mukesh, Jodhu, Modhu                      |
| Anand                                | `pool`       | Anand, Rohit, Rohan                       |
| Team Lead A                          | `team`       | Manish, Ram, Shyaam                       |
| Team Lead B                          | `team`       | Mukesh, Jodhu, Modhu, Anand, Rohit, Rohan |
| Sales Department Head                | `department` | Everyone above                            |

**What this example pins down**

| # Property  |                                                                                                                                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VIS-1       | `team` scope is **transitive**. Team Lead A sees Manish *and everyone beneath Manish*, not just Manish. Resolution walks the full `reportsTo` subtree.                                                        |
| VIS-2       | Team Leads see **disjoint sets**. A cannot see any of B's supervisors or agents, and vice versa, even though both hold the same position at the same level. Enforced by `teamRef`, never by level comparison. |
| VIS-3       | A Team Lead may own **several** pools. B owns two; A owns one. Nothing caps the number.                                                                                                                       |
| VIS-4       | A Supervisor sees only their own pool. Manish cannot see Jodhu, who sits under a different Supervisor in the same department.                                                                                 |
| VIS-5       | The Sales Department Head sees the whole department without being the owner of any record in it (§3.6).                                                                                                       |
| VIS-6       | An Agent sees only their own records — not their pool-mates'. Ram cannot see Shyaam's leads.                                                                                                                  |

**The cross-team case**

Handover is driven by availability, not by reporting line (§10.4 HV-1). Ram may hand a live call to Anand, who sits under a different Team Lead.

| Record Owner / parties Visible to  |                                 |                                                                                     |
| ---------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------- |
| The **lead**                       | Ram                             | Ram, Manish, Team Lead A, Sales Head                                                |
| The **handover**                   | from Ram, to Anand              | Ram, Anand, both chains above them, Sales Head                                      |
| The **deal**                       | sourced by Ram, closed by Anand | Ram, Manish, Team Lead A **and** Anand, Team Lead B, Sales Head                     |
| The **account** after closure      | Ram                             | Ram, Manish, Team Lead A, Sales Head — and the Project Manager, through the project |

The deal is visible through **either** chain (DL-12a), because both did work on it. Sourcing credit stays with Ram and closing credit goes to Anand — two separate metrics, never one number split (DL-12b). Mukesh sees none of it: he was not involved, and being Anand's peer confers nothing.

Data structures this implies: one `sales-team` per Team Lead, one `sales-pool` per Supervisor with `parentTeam` set to their Team Lead's team, and every agent's `teamRef` pointing at their Supervisor's pool. Deal visibility resolves as a union over two owner fields rather than one, which is why `DealPolicy` declares both in its filter.

**Where the Project Manager sits in this picture.** Nowhere, until the deal is won. A Project Manager sees no lead, no handover and no pipeline. Once the deal is won and the project onboarded, they see the **deal that produced their project** — one record, reached through the project, not through the sales hierarchy — and the client account alongside the originating agent.

### 3.6 Accountability Is Not Record Ownership

Two distinct concepts that must never be conflated in implementation.

| Concept Means Expressed as  |                                           |                                                        |
| --------------------------- | ----------------------------------------- | ------------------------------------------------------ |
| **Accountability**          | Who answers for the outcome of a function | Position, reporting line, and the reports they receive |
| **Record ownership**        | Whose name is on this specific record     | An owner field on the record itself                    |
| **Authorization scope**     | How far a principal can see and act       | The scope on each permission policy                    |

The Sales Department Head is *accountable* for the pipeline and holds *department scope* over it. They are not the *owner* of any lead. Lead ownership belongs to the agent working it, and it stays there through handover, disposition and closure.

The same distinction runs the other way in delivery: a Project Manager *owns* the project record and the client account, and directs the work on it, while the Development Department Head *owns the people* doing that work. Authority over the work and authority over the workers are deliberately held by different people.

**Rule OWN-1** — No process may set a record's owner to a person merely because that person has authority over the record's scope. Ownership changes only through an explicit, audited reassignment action.

**Rule OWN-2** — Reports, leaderboards and performance aggregates attribute to the **owner**, not to whoever can see the record. Otherwise the Sales Department Head's conversion rate would be the whole department's.

### 3.7 Reporting Lines

| Field Purpose             |                                                      |
| ------------------------- | ---------------------------------------------------- |
| `Position.parentPosition` | Which position reports to which — the default ladder |
| `User.reportsTo`          | Which specific person this employee reports to       |
| `User.teamRef`            | Which organizational team bounds them                |

**Rules**

- **R-1** `reportsTo` must reference a user whose position is an ancestor of the subject's position within the same department, or Super Admin.
- **R-2** If `reportsTo` is null, the effective manager resolves to the active holders of the parent position within the subject's team. If several qualify, all are managers for read purposes and approvals route to all of them, first responder winning.
- **R-3** Subordinate resolution is transitive. The Sales Department Head's subordinate set includes agents three levels down. A Project Manager's subordinate set is **empty** — they manage nobody on the solid line.
- **R-4** A user cannot be their own manager, directly or through a cycle.
- **R-5** Deactivating a user with direct reports requires reassigning those reports first.

### 3.7.1 Project Accountability — the Dotted Line

`User.reportsTo` is the solid line and answers *who manages this person*. A second relationship answers *who directs this work*, and it is derived, not stored on the user:

```
projectAccountability(user, project) =
    project.projectManager,  where the user holds a task on that project

```

**Rules**

| # Rule  |                                                                                                                                                                                                                                                                                                                         |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PA-1    | A Project Manager holds assignment authority over **tasks belonging to projects they own**, and none anywhere else. Their scope on `tasks:assign` is `own`, where `own` resolves through the task's project to its Project Manager.                                                                                     |
| PA-2    | The dotted line **never** confers people authority. A Project Manager cannot see a developer's attendance, leave, payslip, performance record or break history. Directing someone's work and managing them as an employee are different relationships, and only the solid line carries the second.                      |
| PA-3    | The dotted line **never** confers delegation authority. A Project Manager cannot edit anyone's permissions, including on their own project team.                                                                                                                                                                        |
| PA-4    | **Capacity veto.** The Development Department Head may reject or reassign any PM-originated assignment on capacity grounds, with a recorded reason. The veto is visible to the Project Manager and escalates to Super Admin if disputed. A PM decides what the project needs; they do not decide how many people exist. |
| PA-5    | Where two Project Managers want the same person in the same week, the Development Department Head resolves it. Peer PMs have no mechanism to resolve it between themselves, and inventing one would produce a negotiation with no tie-break.                                                                            |
| PA-6    | Sub-team managers retain review authority (TK-3). A Project Manager can assign a task and set its deadline; only the sub-team manager marks it Done or Revision Needed. Assigning work and judging its quality are separate, and the PM is not the judge of a developer's craft.                                        |
| PA-7    | Every PM-originated assignment records that it came through the dotted line, so the Development Department Head can see at a glance how much of their team's load originated outside the department.                                                                                                                    |

### 3.8 Custom Positions

Super Admin may create positions beyond the seeded sixteen — a Regional Head, a Quality Lead, a second HR tier as the company grows.

**Constraints**

- **C-1** `organizationalLevel` must be strictly less than the parent position's level, and strictly greater than the level of any position that will report to it. Violations are rejected with the specific conflict named.
- **C-2** A custom position must have a parent position. Only Super Admin is parentless, and Super Admin is not a Position (§2.1). Therefore no custom position can be created at the root.
- **C-3** A custom position belongs to exactly one department and cannot hold policy reaching outside that department, except at scope `all`, which only Super Admin may grant.
- **C-4** A custom position's permission policies are subject to the same ceiling rule as delegation: the creator cannot grant a capability or a scope they do not themselves hold. Super Admin, holding everything, is unconstrained here.
- **C-5** A custom position may be inserted between two existing positions. Doing so re-parents the affected positions and requires explicit confirmation, with a preview of every user whose reporting line changes.
- **C-6** Custom positions do not inherit permissions from their parent. They start with everything denied. Inheritance would make a new position silently powerful, which is the opposite of what a new position should be.
- **C-7** Approval limits on a custom position may not exceed those of its parent position.

---

## 4. Authorization Model — Summary

The full specification is `AUTHORIZATION.md`. This section states the model at the requirements level so the rest of this document can reference it.

### 4.1 Permission Policies, Not Flags

A Position does not carry a single scope. It carries a **list of permission policies**, one per action, each with its own reach.

```
Position
  └── policies[]
        ├── action        "deals:view"
        ├── allowed       true
        ├── scope         own | participant | pool | team | department | all-people
        ├── fields        which fields of the resource are readable
        └── constraints   conditions the resource must satisfy

```

**Scope values**

| Scope Reach   |                                                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------------------------------- |
| `own`         | Resources the principal owns or is the subject of                                                                 |
| `participant` | Resources on which the principal is a named party — the two-sided workflow records: briefs, deliveries, approvals |
| `pool`        | Resources owned by members of the principal's agent pool                                                          |
| `team`        | The principal's organizational team, transitively downward                                                        |
| `department`  | The principal's department                                                                                        |
| `all-people`  | Every employee record, **people-domain resources only** (§4.5)                                                    |

A **client** principal has no scope. Client isolation is a principal-to-resource relationship evaluated as absolute constraint A2 before any policy resolution, not a value on this enum. Keeping an outside party's boundary out of the enum an administrator edits means no misconfiguration can select it.

**There is deliberately no** **`all`** **scope.** Organization-wide reach is not a configurable scope value — it is a **protected capability**, `globalAccess`, which only Super Admin holds and which no delegate can grant. Making it look like an ordinary dropdown option is how an unbounded grant gets made by accident.

This is required because the same person legitimately has different reach in different modules. A Project Manager sees deals across the whole department and their own payslip and nobody else's. One position-level scope cannot express that; a per-action scope can.

Worked example — the **Sales Department Head's** policy set, abbreviated. Note that the same principal holds `department` reach on one module and `own` on another, which is precisely what a single position-level scope cannot express:

| Action Allowed Scope Notes  |        |            |                                     |
| --------------------------- | ------ | ---------- | ----------------------------------- |
| `leads:view`                | yes    | department | Whole pipeline                      |
| `deals:view`                | yes    | department | Including commercials               |
| `deals:approve`             | yes    | department | Bounded by approval limits          |
| `clients:manage`            | yes    | department |                                     |
| `projects:view`             | **no** | —          | Their world ends at a confirmed win |
| `tasks:view`                | **no** | —          | Delivery is not theirs              |
| `attendance:view`           | yes    | **own**    | Their own record only               |
| `leave:view`                | yes    | **own**    |                                     |
| `payroll:view`              | yes    | **own**    |                                     |
| `users:manage`              | no     | —          | Cannot create accounts              |

### 4.2 One Action Resolves to One Policy

An action maps to exactly one policy, never to a set of flags where any one suffices. Multiple competing flags create ambiguity about which one granted access and therefore which scope applies.

Where an action needs to behave differently by reach, that difference lives in the policy's `scope`, not in the action name. There is one `leads:view`, not `canViewSubordinateLeads` and `canViewDepartmentLeads`.

### 4.3 Level Does Not Grant Access

`organizationalLevel` is an organizational attribute. It is used by:

- **Delegation** — an actor may only edit the access of someone at a strictly lower level
- **Approval routing** — escalation walks up the reporting chain
- **Tie-breaking** — where two managers both qualify

It is **never** consulted when deciding whether a user may read a record. HR at level 90 does not thereby see the Development department's projects. Access comes from policy plus scope, and HR's policies are people-domain policies.

### 4.4 Per-User Overrides Carry Scope

An override is a full policy, not a boolean. This is what makes "grant this one person a narrower or wider slice" real.

```
User.permissionOverrides[]
  ├── action        "leads:view"
  ├── allowed       true
  ├── scope         "team"          ← can differ from the position default
  ├── fields        optional field-level narrowing
  ├── constraints   optional conditions
  ├── reason        required, free text
  ├── grantedBy     actor
  ├── grantedAt     timestamp
  └── expiresAt     optional; evaluated at authorization time

```

**Expiry is evaluated on every authorization call**, not by a scheduled job. An override expiring at 10:00 stops applying at 10:00. The nightly job performs cleanup only — marking rows, invalidating caches, auditing and notifying. A permission that outlives its stated expiry by up to a day is not an expiring permission.

An override replaces the position's policy for that action. Absent an override, the position's policy applies.

### 4.5 People-Domain and Business-Domain Resources

Every resource type is classified into exactly one domain. The classification is declared on the resource, not inferred, and the engine refuses to evaluate `all-people` scope against a business-domain resource.

**There are exactly two domains.** A resource declares a fixed domain, or derives it from the record it attaches to. "Derived" is a declaration style, not a third domain — every resource *instance* resolves to `people` or `business`.

| Declaration Resources  |                                                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fixed **people**       | Employee, Attendance, Break policy and breach, Shift, Leave, Holiday, Payslip, Salary structure, Performance record, Onboarding workflow, Biometric device and punch, Geofence event |
| Fixed **business**     | Lead, Callback, Handover, Deal, Approval, Territory, Project Brief, Project, Task, Delivery, Change request, Client, Account, Renewal                                                |
| Derived                | Document, Notification, Chat message, Audit entry, Notice — each resolves the domain of the record it attaches to, per instance                                                      |

**Rules**

- **PD-0** A derived resource resolves to `people` or `business` at evaluation time. It never resolves to a third value, and an unresolvable parent fails closed to the more restrictive domain while logging a data defect.
- **PD-1** `all-people` is not a narrower form of unrestricted reach. It is a domain-limited scope. Evaluating it against a business-domain resource is a **programming error** that fails closed and logs as a defect, not a permission denial.
- **PD-2** This is how protected constraint P7 is enforced structurally. HR cannot reach a deal because the scope they hold is undefined for that domain, not because a check remembered to run.
- **PD-3** `all-people` grants **breadth of subject, not depth of field.** Every people-domain resource carrying sensitive data declares a **mandatory field policy**: payslips, salary structures, leave attachments, performance review text and biometric identifiers. Holding `all-people` on a module never implies reading every field of every record in it.
- **PD-4** Mandatory field policies cannot be widened by delegation. They are changed only by Super Admin, and the change is audited.

### 4.6 Delegated Access Management

A user holding `access:delegate` may edit the policies of another user, subject to four constraints:

| # Constraint  |                                                                         |
| ------------- | ----------------------------------------------------------------------- |
| Ceiling       | Cannot grant an action, or a scope wider, than the actor holds          |
| Boundary      | The target must be inside the actor's own scope                         |
| Seniority     | The target's level must be strictly lower than the actor's              |
| Root of trust | `access:delegate` and `users:manage` may only be granted by Super Admin |

Every grant, revoke and expiry writes an audit record with a mandatory reason.

### 4.7 Protected Policies

Some rules are not configurable. They are enforced regardless of what any permission policy says.

**Absolute constraints** — apply to every principal including Super Admin:

| # Rule  |                                                                                                                                                                                                                                                                                                                                        |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1      | **Segregation of duties.** No principal may approve, confirm or sign off an item they initiated. Each approval-bearing action declares which field names its initiator — there is no universal `raisedBy`, and assuming one would silently disable the control wherever the field is named differently. See `AUTHORIZATION.md` §4.1.1. |
| A2      | **Client isolation.** A client principal can only reach resources belonging to their own account.                                                                                                                                                                                                                                      |
| A3      | **Record immutability.** Published payslips, recorded deal approvals, audit entries, delivery sign-offs, **issued invoices, recorded receipts and posted journal entries** cannot be edited, only superseded by a linked correcting document — a revision, a credit note, or a reversing journal.                                      |
| A4      | **Financial period integrity.** Nothing posts into a closed accounting period. A closed period reopens only by Super Admin, with a recorded reason, and both the close and the reopen are audited. This binds every principal including Super Admin: Super Admin may reopen a period, but may not post into one that is closed.        |

**Privileged constraints** — apply to everyone except Super Admin:

| # Rule  |                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1      | **Closing-terms confidentiality.** An agent cannot read the `commercials` of a deal they did not close that passed beyond their own approval limit. **P1 governs the Deal resource only.** Post-closure account ownership (§12.2) is governed by its own account policy and does **not** widen visibility into Deal commercials — an ownership relationship is not a disclosure channel.                    |
| P2      | **Payslip privacy.** A payslip is readable by its subject and by payroll holders. Team scope never reaches payslips.                                                                                                                                                                                                                                                                                        |
| P3      | **Notepad privacy.** Employee notepads are readable by the owner and by Super Admin. Disclosed to employees in-product.                                                                                                                                                                                                                                                                                     |
| P4      | **Leave document privacy.** Attachments on a leave request are readable by HR only.                                                                                                                                                                                                                                                                                                                         |
| P5      | **Task-level client data.** Base delivery employees cannot read client contact details, payment details or contract terms.                                                                                                                                                                                                                                                                                  |
| P6      | **Cross-sub-team isolation.** A sub-team manager cannot reach another sub-team's work.                                                                                                                                                                                                                                                                                                                      |
| P7      | **HR domain boundary.** An HR principal cannot read **business-domain** records — leads, deals and their commercials, revenue, project profitability, client financial records, projects or tasks — at any scope. HR reads derived aggregates only. Compensation and payroll are **people-domain** resources governed by their own policies and mandatory field policies (§4.5); P7 does not restrict them. |

**Protected capabilities** — capabilities that are not grantable through Access Management at all:

| Capability Held by         |                                                                                                                                                                                                                   |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `globalAccess`             | **Derived, never stored**: `globalAccess(p) = p.accountType === "super-admin"`. No column, no policy, no override, no delegation path, no interface control. A boolean on a record is a boolean somebody can set. |
| `access:delegate`          | Granted by Super Admin only. A delegate cannot create another delegate.                                                                                                                                           |
| `users:manage`             | Granted by Super Admin only.                                                                                                                                                                                      |
| `notepad:view-all`         | Super Admin only. Not grantable to anyone.                                                                                                                                                                        |
| `billing:set-terms`        | Super Admin only. Not grantable to anyone, including a Finance Manager (P8).                                                                                                                                      |
| `accounting:reopen-period` | Super Admin only (A4).                                                                                                                                                                                            |
| Mandatory field policies   | Changed by Super Admin only (PD-4).                                                                                                                                                                               |

**Configurability rule** — Access Management may change any permission policy that is neither a protected capability nor governed by a protected constraint. It cannot grant HR access to deals, because P7 governs that. The Access Management UI shows protected capabilities as locked with the governing rule named, rather than offering a control that would silently fail.

### 4.8 Resource-Level Authorization

Different resources have different ownership shapes. A Lead has one owner; a Project has a project manager, a delivery owner, a client and an assigned team. A single generic owner-field check cannot express both.

Every resource type therefore has its own **visibility policy** — a function that translates a user's scope for an action into a query filter for that resource, and a matching object-level check for single-record access. Both live behind one authorization entry point so the call site stays uniform.

**Rules**

- **AZ-1** Every endpoint operating on an object performs an object-level check. Endpoint-level checks alone are insufficient.
- **AZ-2** List endpoints build their filter from the scope before querying. No endpoint fetches broadly and rejects rows afterwards.
- **AZ-3** A denied action produces a filter matching nothing, never an empty filter matching everything.
- **AZ-4** Counts, exports and reports use the same visibility policy as the list they summarize. A count that reveals the existence of invisible records is a leak.
- **AZ-5** Field-level policies are applied by projection. A field the caller cannot see is **omitted** from the response, not nulled.

---

## 5. Module Catalog and Build Classification

Thirty-six modules in six groups. Each module owns its screens, its data and its actions. No screen belongs to two modules.

### 5.1 Foundation (5)

| # Module Owns  |                         |                                                                                                    |
| -------------- | ----------------------- | -------------------------------------------------------------------------------------------------- |
| F1             | `identity`              | Authentication, sessions, MFA, password lifecycle, device management, geofenced login              |
| F2             | `organization`          | Departments, teams, positions, designations, specializations, reporting hierarchy                  |
| F3             | `access-management`     | Permission policies, per-user overrides, delegation, custom positions, role-change requests        |
| F4             | `audit`                 | Audit trail, integrity verification, retention, legal hold, archived log access                    |
| F5             | `system-administration` | Global settings, integrations, approval threshold configuration, notification rules, feature flags |

### 5.2 People (11)

| # Module Owns  |                      |                                                                                                           |
| -------------- | -------------------- | --------------------------------------------------------------------------------------------------------- |
| H1             | `employee-directory` | Employee profiles, employment status, the 360 view                                                        |
| H2             | `onboarding`         | Onboarding and offboarding workflows and checklists                                                       |
| H3             | `live-status`        | Real-time working / break / absent board                                                                  |
| H4             | `attendance`         | Punch events, calculated records, corrections, daily/weekly/monthly reporting                             |
| H5             | `break-management`   | Break limits, penalty rules, breach review, employee allowance display                                    |
| H6             | `shifts`             | Shift templates, assignment, rotations, flexible and change requests                                      |
| H7             | `biometric`          | Device registry, PIN mapping, punch ingestion, device health                                              |
| H8             | `leave`              | Leave types, balances, applications, approval routing, calendar, and Work From Home as an attendance mode |
| H9             | `holidays`           | Holiday calendar, shift and department scoping, comp-off eligibility                                      |
| H10            | `payroll`            | Salary structures, payroll runs, statutory configuration, payslips                                        |
| H11            | `performance`        | Derived KPIs, review cycles, project participation history                                                |

### 5.3 Sales (6)

| # Module Owns  |               |                                                                                             |
| -------------- | ------------- | ------------------------------------------------------------------------------------------- |
| S1             | `territories` | Regions, verticals and product lines; team assignment to them; lead routing rules           |
| S2             | `leads`       | Sources and campaigns, capture, assignment, activity timeline, lost-lead re-engagement      |
| S3             | `callbacks`   | Scheduling, reminder ladder, outcomes, stall detection                                      |
| S4             | `handovers`   | Live-call escalation from agent to supervisor or team lead                                  |
| S5             | `deals`       | Pipeline, commercials, proposals, contracts, payments, win recording                        |
| S6             | `approvals`   | Threshold configuration, approval routing, delegation during absence, segregation of duties |

### 5.4 Delivery (5)

| # Module Owns  |                     |                                                                               |
| -------------- | ------------------- | ----------------------------------------------------------------------------- |
| D1             | `handoff`           | Project Brief compilation, feasibility review, revision loop                  |
| D2             | `projects`          | Projects, teams, milestones, timeline, dependencies, health                   |
| D3             | `tasks`             | Task lifecycle, assignment, review, revision, dependencies, time tracking     |
| D4             | `resource-planning` | Capacity, workload, allocation across the three sub-teams                     |
| D5             | `delivery`          | Delivery approval, client sign-off, change requests, free-fix versus billable |

### 5.5 Client (3)

| # Module Owns  |                 |                                                                        |
| -------------- | --------------- | ---------------------------------------------------------------------- |
| C1             | `clients`       | Client records, portal credentials, account ownership, client requests |
| C2             | `post-closure`  | Renewals, upsell pipeline, revenue history per account                 |
| C3             | `client-portal` | The external-facing surface, isolated by absolute constraint A2        |

### 5.6 Finance (6)

| # Module Owns  |                 |                                                                                                                                                |
| -------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| N1             | `billing-terms` | Rate cards, negotiated pricing, payment terms, credit limits, write-off authority — **what each client pays**. Super Admin exclusive (§4.7 P8) |
| N2             | `invoicing`     | Invoice lifecycle, statutory numbering, GST computation, credit and debit notes, e-invoicing, recurring schedules                              |
| N3             | `payments`      | Receipts, allocation to invoices, advances, refunds, bank reconciliation                                                                       |
| N4             | `receivables`   | Aging, dunning, statements of account, TDS reconciliation, collections queue                                                                   |
| N5             | `payables`      | Vendor bills, employee reimbursements, payment runs                                                                                            |
| N6             | `accounting`    | Chart of accounts, double-entry journals, ledgers, period close, financial statements, tax filing exports                                      |

### 5.7 Cross-Cutting (6)

| # Module Owns  |                         |                                                                          |
| -------------- | ----------------------- | ------------------------------------------------------------------------ |
| X1             | `chat`                  | Internal messaging, group and channel conversations, presence            |
| X2             | `project-communication` | Client-facing project threads and the communication tracker              |
| X3             | `documents`             | Files, templates, versioning, signed delivery                            |
| X4             | `reporting`             | Dashboards, standard reports, exports, sales forecasting                 |
| X5             | `notifications`         | Multi-channel delivery, preferences, digests, quiet hours                |
| X6             | `workspace`             | Notepad, personal todo, sheets, notice board, own profile, global search |

**Total: 42 modules.**

### 5.8 Build Classification

Classification for planning and estimation. **Class** describes the nature of the build, which is what drives effort far more than feature count does.

| Class Meaning   |                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Platform**    | Infrastructure every other module depends on. Must be correct before anything else ships.                                      |
| **Workflow**    | Multi-party state machines with approvals, queues and SLAs. Effort is concentrated in state and permission logic, not screens. |
| **Records**     | Structured CRUD with scoped lists, validation and audit. Well-understood work.                                                 |
| **Calculation** | Arithmetic that must reconcile to the rupee, with idempotent recomputation. Effort is concentrated in test coverage.           |
| **Integration** | Depends on an external system or protocol. Effort is concentrated in failure handling.                                         |
| **Analytics**   | Read-only aggregation over other modules. Cannot start before its sources exist.                                               |

| Module Class Complexity Depends on Notes  |             |               |                                           |                                                                        |
| ----------------------------------------- | ----------- | ------------- | ----------------------------------------- | ---------------------------------------------------------------------- |
| `identity`                                | Platform    | High          | —                                         | MFA, sessions, geofencing                                              |
| `organization`                            | Platform    | Medium        | —                                         | Departments, teams, positions                                          |
| `access-management`                       | Platform    | **Very high** | `organization`                            | The engine and its interface                                           |
| `audit`                                   | Platform    | Medium        | —                                         | Hash chaining, archival, holds                                         |
| `system-administration`                   | Platform    | Medium        | `access-management`                       | Settings, thresholds, flags                                            |
| `employee-directory`                      | Records     | Medium        | `organization`                            | 360 view is per-tab authorization                                      |
| `onboarding`                              | Workflow    | Low           | `employee-directory`                      | Checklists with blockers                                               |
| `live-status`                             | Platform    | Medium        | `attendance`                              | Real-time projection                                                   |
| `attendance`                              | Calculation | **Very high** | `shifts`                                  | Precedence rules, corrections, idempotency                             |
| `break-management`                        | Workflow    | Medium        | `attendance`                              | Policy resolution, penalty ladder                                      |
| `shifts`                                  | Calculation | High          | —                                         | Overnight shifts, resolution chain                                     |
| `biometric`                               | Integration | Medium        | `attendance`                              | Device protocol, clock skew, replay                                    |
| `leave`                                   | Workflow    | Medium        | `attendance`                              | Two-stage routing, balances                                            |
| `holidays`                                | Records     | Low           | `shifts`                                  | Shift and department scoping                                           |
| `payroll`                                 | Calculation | **Very high** | `attendance`, `leave`, `break-management` | Statutory config, immutability, revisions                              |
| `performance`                             | Analytics   | Medium        | most modules                              | Aggregation without record access                                      |
| `territories`                             | Records     | Low           | `organization`                            | Routing rules                                                          |
| `leads`                                   | Records     | Medium        | `territories`                             | Scoped lists, dedup, activity timeline                                 |
| `callbacks`                               | Workflow    | Medium        | `leads`, `notifications`                  | Reminder ladder, delivery receipts                                     |
| `handovers`                               | Workflow    | High          | `leads`, `live-status`                    | Real-time offer, expiry, availability                                  |
| `deals`                                   | Workflow    | **Very high** | `handovers`, `approvals`                  | Five state dimensions, field-level confidentiality                     |
| `approvals`                               | Workflow    | High          | `organization`                            | Thresholds, escalation, delegation, SoD                                |
| `handoff`                                 | Workflow    | Medium        | `deals`, `projects`                       | The feasibility gate                                                   |
| `projects`                                | Records     | High          | `handoff`                                 | Dual-thread separation, derived health                                 |
| `tasks`                                   | Workflow    | High          | `projects`                                | Lifecycle, dependencies, time tracking                                 |
| `resource-planning`                       | Analytics   | Medium        | `tasks`, `leave`                          | Derived capacity                                                       |
| `delivery`                                | Workflow    | Medium        | `projects`                                | Sign-off, change classification                                        |
| `clients`                                 | Records     | Medium        | —                                         | Credentials, requests, SLA                                             |
| `post-closure`                            | Workflow    | Medium        | `deals`, `clients`                        | Ownership transfer, renewals                                           |
| `client-portal`                           | Platform    | High          | `clients`, `projects`                     | Isolation is a security boundary                                       |
| `chat`                                    | Integration | High          | `identity`                                | Real-time, presence, attachments                                       |
| `project-communication`                   | Records     | Medium        | `projects`                                | Thread separation, tracker                                             |
| `documents`                               | Integration | Medium        | —                                         | Storage, signing, versioning, templates                                |
| `reporting`                               | Analytics   | High          | most modules                              | Every report is scope-gated                                            |
| `notifications`                           | Integration | High          | `access-management`                       | Audience via the engine, multi-channel                                 |
| `workspace`                               | Records     | Medium        | —                                         | Search is scope-filtered at query time                                 |
| `billing-terms`                           | Records     | Low           | `clients`                                 | Small surface, maximum sensitivity                                     |
| `invoicing`                               | Calculation | **Very high** | `billing-terms`, `accounting`             | Statutory numbering, GST by place of supply, e-invoicing, immutability |
| `payments`                                | Records     | High          | `invoicing`                               | Allocation, advances, reconciliation                                   |
| `receivables`                             | Workflow    | Medium        | `invoicing`, `payments`                   | Aging, dunning, TDS matching, write-offs                               |
| `payables`                                | Workflow    | Medium        | `accounting`                              | Bills, reimbursements, payment runs                                    |
| `accounting`                              | Calculation | **Very high** | everything financial                      | Double-entry, revenue recognition, period close, statements            |

**Summary by class**

| Class Count  |    |
| ------------ | -- |
| Platform     | 8  |
| Workflow     | 13 |
| Records      | 12 |
| Calculation  | 5  |
| Integration  | 5  |
| Analytics    | 4  |

Six modules are marked **very high** complexity — `access-management`, `attendance`, `payroll`, `deals`, `invoicing` and `accounting`. Together they represent the majority of the risk in the programme. Each has a property that punishes shortcuts: the access engine because a mistake is a breach, attendance and payroll because a mistake is someone's pay, deals because a mistake is a commercial commitment nobody authorized, and the two finance modules because a mistake is either a statutory breach or a set of books that does not balance.

---

## 6. Permission Matrix

The default policy set seeded for each Position. Every cell is a **scope** for that module's primary read action, except where noted.

**These cells are shorthand for a default authorization configuration — they are not literal** **`Scope`** **enum values.** A cell may denote a scope, a protected capability, a client relationship boundary, or the absence of any policy. The executable definition is the Action Registry in `AUTHORIZATION.md` §6; this table is the human-readable summary of what it should contain.

**Legend**

| Cell Means Is it a `Scope`?  |                                                                                                                      |                                               |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `glob`                       | The `globalAccess` protected capability, derived from account type                                                   | **No** — a capability, not a scope            |
| `acct`                       | Client relationship boundary, applied as absolute constraint A2 before policy resolution                             | **No** — a principal-to-resource relationship |
| `all-ppl`                    | `all-people` scope, people-domain resources only                                                                     | Yes                                           |
| `dept`                       | `department` scope                                                                                                   | Yes                                           |
| `team`                       | `team` scope                                                                                                         | Yes                                           |
| `pool`                       | `pool` scope                                                                                                         | Yes                                           |
| `part`                       | `participant` scope                                                                                                  | Yes                                           |
| `own`                        | `own` scope                                                                                                          | Yes                                           |
| `—`                          | No policy for this module                                                                                            | —                                             |
| `*` suffix                   | **Read-only at that scope**: the module's `:view` action is granted, and no write action of that module has a policy | Modifier, not a scope                         |

The `*` modifier replaces what would otherwise be a pseudo-scope called "view". Read-only is not a reach; it is an absence of write capability at a given reach. `dept*` therefore means `<module>:view` at `department` scope, with every write action of that module unmapped.

| Module Super Admin HR HR Exec Sales Head Project Mgr Dev Dept Head Sales Team Lead Sub-team Mgr Sales Supervisor Agent / Dev Employee Client  |      |           |           |           |           |           |           |           |           |           |      |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --------- | --------- | --------- | --------- | --------- | --------- | --------- | --------- | --------- | ---- |
| `identity`                                                                                                                                    | glob | —         | —         | —         | —         | —         | —         | —         | —         | —         | —    |
| `organization`                                                                                                                                | glob | dept\*    | —         | dept\*    | dept\*    | dept\*    | —         | —         | —         | —         | —    |
| `access-management`                                                                                                                           | glob | —         | —         | —         | —         | —         | —         | —         | —         | —         | —    |
| `audit`                                                                                                                                       | glob | all-ppl\* | —         | —         | —         | —         | —         | —         | —         | —         | —    |
| `system-administration`                                                                                                                       | glob | —         | —         | —         | —         | —         | —         | —         | —         | —         | —    |
| `employee-directory`                                                                                                                          | glob | all-ppl   | all-ppl   | dept\*    | —         | dept\*    | —         | —         | —         | —         | —    |
| `onboarding`                                                                                                                                  | glob | all-ppl   | all-ppl   | —         | —         | —         | —         | —         | —         | own       | —    |
| `live-status`                                                                                                                                 | glob | all-ppl   | all-ppl   | own       | own       | own       | team      | team      | pool      | own       | —    |
| `attendance`                                                                                                                                  | glob | all-ppl   | all-ppl   | own       | own       | own       | own       | own       | own       | own       | —    |
| `break-management`                                                                                                                            | glob | all-ppl   | all-ppl\* | team\*    | own       | team\*    | team      | team      | pool      | own       | —    |
| `shifts`                                                                                                                                      | glob | all-ppl   | all-ppl   | own       | own       | own       | own       | own       | own       | own       | —    |
| `biometric`                                                                                                                                   | glob | all-ppl   | —         | —         | —         | —         | —         | —         | —         | —         | —    |
| `leave`                                                                                                                                       | glob | all-ppl   | all-ppl   | own       | own       | own       | own       | own       | own       | own       | —    |
| `holidays`                                                                                                                                    | glob | all-ppl   | all-ppl\* | all-ppl\* | all-ppl\* | all-ppl\* | all-ppl\* | all-ppl\* | all-ppl\* | all-ppl\* | —    |
| `payroll`                                                                                                                                     | glob | all-ppl   | —         | own       | own       | own       | own       | own       | own       | own       | —    |
| `performance`                                                                                                                                 | glob | all-ppl   | all-ppl   | team      | own       | team      | team      | team      | pool      | own       | —    |
| `territories`                                                                                                                                 | glob | —         | —         | dept      | —         | —         | team      | —         | —         | —         | —    |
| `leads`                                                                                                                                       | glob | —         | —         | dept      | —         | —         | team      | —         | pool      | own       | —    |
| `callbacks`                                                                                                                                   | glob | —         | —         | dept      | —         | —         | team      | —         | pool      | own       | —    |
| `handovers`                                                                                                                                   | glob | —         | —         | dept      | —         | —         | team      | —         | pool      | own       | —    |
| `deals`                                                                                                                                       | glob | —         | —         | dept      | part\*    | —         | team      | —         | pool      | own       | —    |
| `approvals`                                                                                                                                   | glob | —         | —         | dept      | —         | —         | team      | —         | pool      | part      | —    |
| `handoff`                                                                                                                                     | glob | —         | —         | part      | part      | part      | —         | —         | —         | —         | —    |
| `projects`                                                                                                                                    | glob | —         | —         | —         | own       | dept      | —         | team      | —         | own       | acct |
| `tasks`                                                                                                                                       | glob | —         | —         | —         | own       | dept      | team      | team      | pool      | own       | —    |
| `resource-planning`                                                                                                                           | glob | —         | —         | —         | own\*     | dept      | team      | team      | —         | —         | —    |
| `delivery`                                                                                                                                    | glob | —         | —         | —         | part      | part      | —         | team\*    | —         | —         | acct |
| `clients`                                                                                                                                     | glob | —         | —         | dept      | own       | dept\*    | team      | —         | pool      | own       | acct |
| `post-closure`                                                                                                                                | glob | —         | —         | dept      | own       | —         | team      | —         | pool      | own       | —    |
| `client-portal`                                                                                                                               | glob | —         | —         | dept      | own       | —         | —         | —         | —         | —         | acct |
| `chat`                                                                                                                                        | glob | dept      | dept      | dept      | dept      | dept      | dept      | dept      | dept      | dept      | —    |
| `project-communication`                                                                                                                       | glob | —         | —         | —         | own       | dept      | —         | team      | —         | —         | acct |
| `documents`                                                                                                                                   | glob | all-ppl   | all-ppl   | dept      | own       | dept      | team      | team      | pool      | own       | acct |
| `reporting`                                                                                                                                   | glob | all-ppl   | all-ppl\* | dept      | own       | dept      | team      | team      | pool      | own       | acct |
| `notifications`                                                                                                                               | glob | own       | own       | own       | own       | own       | own       | own       | own       | own       | acct |
| `billing-terms`                                                                                                                               | glob | —         | —         | —         | —         | —         | —         | —         | —         | —         | —    |
| `invoicing`                                                                                                                                   | glob | —         | —         | —         | own\*     | —         | —         | —         | —         | —         | acct |
| `payments`                                                                                                                                    | glob | —         | —         | —         | own\*     | —         | —         | —         | —         | —         | acct |
| `receivables`                                                                                                                                 | glob | —         | —         | —         | own\*     | —         | —         | —         | —         | —         | acct |
| `payables`                                                                                                                                    | glob | —         | —         | —         | —         | —         | —         | —         | —         | own       | —    |
| `accounting`                                                                                                                                  | glob | —         | —         | —         | —         | —         | —         | —         | —         | —         | —    |
| `workspace`                                                                                                                                   | glob | own       | own       | own       | own       | own       | own       | own       | own       | own       | —    |

**Finance columns are omitted from the table above** because Finance ships inactive (D-6). When staffed, the two positions hold:

| Module Finance Manager Accountant  |                                                  |        |
| ---------------------------------- | ------------------------------------------------ | ------ |
| `billing-terms`                    | — *(read grantable by Super Admin; write never)* | —      |
| `invoicing`                        | dept                                             | dept   |
| `payments`                         | dept                                             | dept   |
| `receivables`                      | dept                                             | dept   |
| `payables`                         | dept                                             | dept   |
| `accounting`                       | dept                                             | dept\* |
| `employee-directory`               | —                                                | —      |
| everything else                    | own                                              | own    |

Until Finance is staffed, Super Admin holds all six modules and grants individual actions — most commonly `invoicing:create` — to named people.

### 6.1 Reading the Non-Obvious Cells

**`organization`** **reads** **`view`** **for three positions, but that is three capabilities, not one.** Branch heads hold structure and people visibility for their own department plus structure-only elsewhere. None of them hold `org:view-policies` — the access model is not organizational information (OR-12 to OR-14).

**HR is broad across people and blank across business.** Every people module reads `all-ppl`; every sales and delivery module reads `—`. HR's breadth is a domain, not a company-wide grant. Governed by protected constraint P7.

**Project Managers see disjoint sets.** Every finance, project and client cell in their column is `own`, which here means *their own portfolio*. Two Project Managers can no more see each other's projects than two Sales Team Leads can see each other's pipelines, and for the same reason — they are peers with no chain between them.

**Everyone below branch-head level has** **`own`** **on attendance, leave and payroll.** Line managers do not receive subordinate people-data through team scope. People data is HR's domain. Managers get **team** scope on `live-status`, `performance` and `break-management` because those are operational — a manager needs to know who is working, who is loaded and whose breaks are running long, without seeing their salary or their medical certificate.

**The Sales Head and the Project Manager are the same split, read twice.**

Look down the two columns and they are almost complementary. The Sales Head has `dept` across leads, callbacks, handovers, deals, approvals and territories, and a **dash** across projects, tasks, resource-planning and delivery. The Project Manager has the reverse: `own` across projects, delivery, clients and communication, and a **dash** across the entire pipeline.

They meet in exactly two cells — `handoff`, where both are `part` because the brief is a two-party document, and `clients`, where Sales holds the account commercially at `dept` and the PM holds their own portfolio at `own`.

**The Project Manager reads** **`own`** **on tasks — write, not read-only.** This is the dotted line (§3.7.1). They hold `tasks:assign` and `tasks:manage-dependencies` scoped to tasks on projects they own, and nothing outside those projects.

Three things they still do **not** hold, and the absence is deliberate:

| Not held Why                  |                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `tasks:review`                | Sub-team managers judge the work. Assigning a task and marking it Done are different acts (PA-6).                                           |
| `resources:allocate`          | `resource-planning` is `own*` — read-only. They see capacity to plan around it; the Development Department Head decides who is free (PA-4). |
| Any people action on the team | Directing work is not managing people. No attendance, leave, payroll, performance or break visibility (PA-2).                               |

**The Project Manager reads** **`part*`** **on deals** — participant scope, read-only. They see the one deal that produced a project they own, reached through the project rather than through the sales hierarchy. Not the pipeline, not their client's other deals, not the deal's approval history.

**Sales Team Lead is** **`team`****; Sales Supervisor is** **`pool`****.** Different boundaries. A Team Lead sees every pool beneath them; a Supervisor sees one.

**Sub-team managers are** **`team`** **with cross-sub-team access removed** by protected constraint P6. Three managers, three disjoint boundaries, enforced above policy. Their `delivery` cell is `team*` — they see the delivery state of their own sub-team's work and cannot approve delivery, which belongs to the Department Head (DV-1).

**`billing-terms`** **and** **`accounting`** **are** **`glob`** **and nothing else.** Setting what a client pays, and the general ledger itself, are Super Admin's alone at launch. `billing-terms` write authority is **never** grantable (protected constraint P8); `accounting` becomes `dept` for Finance when that department is activated.

**The Project Manager reads** **`own*`** **on invoicing, payments and receivables.** What *their own* clients have been invoiced, paid and still owe — which is what a renewal or escalation conversation requires. They cannot raise an invoice, record a receipt or alter a term. The Sales Head sees none of it: once the win is recorded, the money conversation belongs to whoever owns the account day to day.

**`payables`** **is** **`own`** **for every employee.** That cell is expense reimbursement: an employee submits their own claims and sees their own status. It is not visibility of company payables.

**HR has a dash across all six finance modules.** Payroll produces a journal entry that posts to the ledger, and HR cannot read the ledger it posts to (P7, §13.6 LG-4 and LG-9). The flow is one-way by design.

**`holidays`** **is** **`all-ppl*`** **for everyone.** The company calendar is genuinely company-wide read-only data, and it is a people-domain resource, so `all-people` read-only is the honest description rather than a special case.

**`handoff`** **and** **`delivery`** **read** **`part`** **— participant scope.** The Project Manager and the Development Department Head are the two named parties to every brief and every delivery, so participant scope gives each of them their complete queue without granting organization-wide reach. This is tighter and more honest than a global scope: it says *why* they see the record.

**Agents have** **`own`** **on clients and post-closure**, because they own the account relationship after closure, while protected constraint P1 keeps closing terms out of their view. `own` on clients means accounts where they are the account owner — see §12.2 for how ownership transfers.

**`chat`** **reads** **`dept`****, not** **`all`****.** Everyone may message anyone within the organization; there is no `all` scope to hold, and cross-organization messaging does not exist. Presence and directory lookup for chat are department-scoped reads that resolve across departments through the shared employee index, which exposes name, designation and availability only.

**`notifications`** **reads** **`own`****.** A principal reads their own notification feed. Audience *resolution* — deciding who a notification goes to — happens server-side through the authorization engine (NT-1) and is not a scope anyone holds.

### 6.2 Configurability

Every cell in this matrix is a **default**, editable from Access Management without a deployment, subject to the delegation constraints in §4.6 — except where a protected constraint governs it (§4.7). Protected cells render as locked with the governing rule named.

---

## 7. End-to-End Workflows

Eight stages, numbered 0 through 7. Each transition is a record with an owner and a timestamp, which is what makes a stalled stage visible.

| Stage Name Owner Produces  |                                     |                                                         |                                      |
| -------------------------- | ----------------------------------- | ------------------------------------------------------- | ------------------------------------ |
| 0                          | Lead Sourcing                       | Marketing / Agent                                       | Lead                                 |
| 1                          | Sales Communication and Disposition | Agent → Supervisor / Team Lead                          | Handover + disposition               |
| 2                          | Approval and Escalation             | Threshold-driven                                        | Approval decision                    |
| 3                          | Win Confirmation                    | Sales Department Head                                   | Deal at lifecycle `won`              |
| 4                          | Handoff and Feasibility             | Sales Head drafts → PM confirms → Dev Dept Head reviews | Project Brief decision               |
| 5                          | Delivery Execution                  | Development Dept Head → sub-teams                       | Completed tasks                      |
| 6                          | Delivery and Client Feedback        | Dev Dept Head → PM → Client                             | Sign-off or change request           |
| 7                          | Post-Closure                        | Account owner (Agent)                                   | Renewal opportunity, revenue history |

### 7.1 Stage 0 — Lead Sourcing

**Inbound**, generated by the Digital & Marketing sub-team:

- Website contact form
- Social media direct message or comment
- Paid ads to a landing page
- Referral from an existing client
- WhatsApp or email inquiry

**Outbound**, initiated by an Agent or Team Lead:

- Cold calling from lead lists
- Cold email
- LinkedIn outreach
- Networking events and exhibitions
- Personal contacts

The lead is created and tagged with source, campaign and contact information, then routed to an agent by territory rules (§10.1) or assigned by a Supervisor.

### 7.2 Stage 1 — Sales Communication and Disposition

```
                        LEAD ASSIGNED TO AGENT
                                 │
                                 ▼
                   AGENT: first call (~2–3 min)
                    Discovery → Proposal → Follow-up
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │  Is the client interested? │
                    └───────────┬─────────────┘
                    │                         │
                   No                        Yes
                    │                         │
                    ▼                         ▼
               CLOSED LOST        SUPERVISOR or TEAM LEAD
             (reason logged,       takes over the live call
              kept for re-                    │
              engagement)                     ▼
                              ┌───────────────────────────────┐
                              │      DISPOSITION DECISION      │
                              └───────────────┬───────────────┘
                    ┌─────────────────────────┼─────────────────────────┐
                    ▼                         ▼                         ▼
                ACCEPTED                  REJECTED                  CALLBACK
         Deal created; agent          Reason logged;        Date and time set;
         leaves the negotiation       Closed Lost           CALLBACK RETURNS
                    │                                       TO THE AGENT, who
                    │                                       works it and re-
                    ▼                                       enters this flow
        ┌───────────────────────┐
        │ Threshold check runs   │
        └───────────┬───────────┘
                    │
        Within closer's limit? ──Yes──► Proceed to closing
                    │ No
                    ▼
              Escalate (§7.3)

```

**Key rules**

- The takeover is a **live call handover**, not a record reassignment. The agent keeps ownership of the lead throughout.
- A **callback created during a handover is assigned back to the originating agent**, who is notified with the full context and works the call.
- On **ACCEPTED**, the agent leaves the negotiation. They retain lead ownership, see that the deal was won, and are credited — but not the terms.

### 7.3 Stage 2 — Approval and Escalation

Escalation is driven by **value and terms**, evaluated automatically. There is no "escalate" button.

```
   Deal recorded with value / discount / terms
                     │
                     ▼
        Within the closer's approval limit?
             │                    │
            Yes                   No
             │                    │
             ▼                    ▼
        Proceed to      Route to the next position
         closing          up the reporting chain
                                  │
                     ┌────────────┼────────────┐
                     ▼            ▼            ▼
                Supervisor    Team Lead    SALES DEPT HEAD
                (small        (mid-level   (high value,
                 discounts)    discounts,   enterprise,
                               custom       contract and
                               terms)       payment sign-off)

```

Any level may close a deal within its own configured limit. An agent closing a small deal at list price is a normal path, not an exception.

### 7.4 Stage 3 — Win Confirmation

Whoever closed it, the win is reported to the **Sales Department Head** for the official record and handoff preparation.

- Agent closes a small deal → reported to the Sales Department Head
- Supervisor closes a mid-size deal → reported to the Sales Department Head
- Team Lead closes a large deal → reported to the Sales Department Head
- Sales Department Head closes an enterprise deal → recorded directly

The Sales Department Head confirms the advance payment (`deals:confirm-payment`) and then records the win (`deals:record-win`), which sets `lifecycleStatus = won`. Both acts are separate and both are audited. The win cannot be recorded while any of the four predicates in §10.5 is unmet.

### 7.5 Stage 4 — Handoff and Feasibility

```
        SALES DEPT HEAD drafts the Project Brief from the won deal
   requirements · budget · timeline · contact · files · sales notes
                            │
                            ▼
              PROJECT MANAGER is assigned and CONFIRMS
         Reviews the draft against what can actually be delivered.
         Queries anything unclear back to Sales before it goes further.
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
        CONFIRMED                   QUERIED BACK
              │                  reason required; Sales Head
              │                  amends the draft or renegotiates
              ▼                  with the client
     DEVELOPMENT DEPT HEAD                │
     reviews for feasibility  ◄───────────┘
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
          ACCEPTED                   FLAGGED BACK
       Project created,        reason required; returns to the
       PM owns it,             PROJECT MANAGER, who renegotiates
       team allocation         scope, budget or timeline with the
                               client and resubmits a linked revision

```

**Why two steps before feasibility.** Sales knows what was sold; the Project Manager knows what can be delivered and will be held to it. A brief that goes straight from the closing conversation to Development carries whatever was promised in the room, and the person who has to deliver it first sees it as a commitment rather than a proposal. The confirm step costs a day and is the last cheap moment to catch a mismatch.

The brief is the **permission boundary** between the departments. It carries requirements, budget, timeline and contact. It does not carry the deal, the discount or the pipeline — which is why Development needs no sales access and still has everything it needs.

**A project is created only from an accepted brief**, and the confirming Project Manager becomes its owner. There is no other path to a client project.

### 7.6 Stage 5 — Delivery Execution

```
                  DEVELOPMENT DEPT HEAD
              allocates across three sub-teams
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
   DEVELOPER TEAM     DIGITAL & MKTG       CONTENT TEAM
      MANAGER            MANAGER              MANAGER
        │                   │                   │
     Developers      Marketing Execs      Content Writers
        │                   │                   │
        └───────────────────┼───────────────────┘
                            ▼
              To Do → In Progress → Review → Done
                            ▲            │
                            └── Revision ┘
                                Needed
                          (manager rejection, notes required)
                            │
                            ▼
        Dept Head monitors combined progress and resolves
              cross-sub-team dependencies

```

### 7.7 Stage 6 — Delivery and Client Feedback

```
      DEVELOPMENT DEPT HEAD marks the project "Delivered"
                            │
                            ▼
        PROJECT MANAGER shares the deliverable with the client
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
        Client approves            Client requests changes
              │                           │
              ▼                           ▼
        Project CLOSED           PM logs and CLASSIFIES:
                                  free fix or billable
                                          │
                                          ▼
                             Dev Dept Head assigns to the
                             RELEVANT SUB-TEAM ONLY;
                             re-enters the task lifecycle

```

Classification is a commercial decision and belongs to the Project Manager. A billable change above threshold routes through the approval chain like any other commitment.

### 7.8 Stage 7 — Post-Closure

- The **originating Agent** is the account owner and handles final client feedback, upsell and renewal conversations.
- Renewal opportunities are generated automatically from contract end dates.
- **HR logs performance data** for every employee involved across Sales and Development — as derived aggregates, without gaining access to the underlying business records.
- Revenue history accrues to the client account.
- **Super Admin retains full lifecycle visibility** — revenue generated, delivery timeline, team performance and client outcome — through the cross-department dashboard. This is the one view that spans all three functions.

---

## 8. Module Specifications — Foundation

Each specification states purpose, screens, rules and acceptance criteria. Rule identifiers are stable and are the contract that `TEST_PLAN.md` maps to tests.

### 8.1 `identity` — Authentication and Sessions

**Purpose.** Establish who a principal is, keep that established safely, and end it promptly when it should end.

**Screens.** Login · Forgot password · Reset password · MFA enrolment · MFA challenge · My sessions and devices *(in* *`workspace`**)*

**Requirements**

| # Requirement  |                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ID-1           | Login accepts an employee email or a client email with explicit account-type selection. The two are independent namespaces and an address may exist in both.                                                                                                                                                                                                                                                                                                    |
| ID-2           | Passwords are hashed with a memory-hard algorithm at current-standard parameters. Passwords are never returned, displayed or logged.                                                                                                                                                                                                                                                                                                                            |
| ID-3           | Password policy: minimum 12 characters, checked against a breached-password corpus, no composition rules that force predictable substitutions.                                                                                                                                                                                                                                                                                                                  |
| ID-4           | Multi-factor authentication is available to all users and **required** for Super Admin and for any position holding payroll, access-management or system-administration policy.                                                                                                                                                                                                                                                                                 |
| ID-5           | **Second factors carry an assurance level and they are not interchangeable.** High assurance: passkey / WebAuthn security key, or TOTP authenticator app. Low assurance: email one-time code.                                                                                                                                                                                                                                                                   |
| ID-5a          | **Privileged positions must use a high-assurance factor.** Email OTP does not satisfy the ID-4 requirement, because the email account is itself a credential that can be compromised — an OTP delivered to a compromised mailbox is not a second factor, it is the same factor twice.                                                                                                                                                                           |
| ID-5b          | Email OTP is available to non-privileged users as an optional second factor, and to anyone as a **recovery** path, never as the primary factor on a privileged account.                                                                                                                                                                                                                                                                                         |
| ID-5c          | Recovery codes are issued once at enrolment, are single-use, and their consumption notifies the user and Super Admin.                                                                                                                                                                                                                                                                                                                                           |
| ID-5d          | Passkeys are the recommended default. The interface presents them first.                                                                                                                                                                                                                                                                                                                                                                                        |
| ID-6           | Access tokens are short-lived (default 60 minutes) with rotating refresh tokens. Refresh-token reuse detection revokes the whole family and alerts the user.                                                                                                                                                                                                                                                                                                    |
| ID-7           | Every account carries a session version. Deactivation, password change, role change or explicit revocation increments it and invalidates all sessions within 60 seconds.                                                                                                                                                                                                                                                                                        |
| ID-8           | Users can list their active sessions with device, approximate location, IP and last activity, and revoke any of them individually or all at once.                                                                                                                                                                                                                                                                                                               |
| ID-9           | Brute-force protection: progressive delay then temporary lockout per account and per source address. Lockout is releasable by HR or Super Admin.                                                                                                                                                                                                                                                                                                                |
| ID-10          | Suspicious-login detection: a sign-in from a new device, a new country, or an improbable travel pattern notifies the user and Super Admin. It does not block by default.                                                                                                                                                                                                                                                                                        |
| ID-11          | Password reset is by emailed single-use token with a 30-minute expiry. Using it invalidates all existing sessions.                                                                                                                                                                                                                                                                                                                                              |
| ID-12          | Email addresses are verified at account creation. An unverified account can sign in but cannot receive password resets.                                                                                                                                                                                                                                                                                                                                         |
| ID-13          | **Geofenced login** may be enabled per individual, never globally. The user may sign in from any one of their assigned locations.                                                                                                                                                                                                                                                                                                                               |
| ID-14          | Geofence locations are shared references. Moving an office updates every assignee at once.                                                                                                                                                                                                                                                                                                                                                                      |
| ID-15          | A denied geofenced login records the reported position, accuracy and distance to the nearest allowed location, and notifies geofence administrators.                                                                                                                                                                                                                                                                                                            |
| ID-15a         | **Location data handling.** Reported coordinates are retained for **90 days** and then deleted; the derived decision (allowed / denied, with distance band) is retained for the audit period. Coordinates are encrypted at rest, readable only by `identity:manage-geofence` holders and Super Admin, and are used **solely** for the access decision and its audit — never for productivity measurement, never for locating an employee outside a login event. |
| ID-15b         | Employees subject to geofencing are told so in-product, with the locations they are fenced to and the retention period stated. Nothing here is silent.                                                                                                                                                                                                                                                                                                          |
| ID-15c         | **Browser geolocation is advisory, not tamper-proof.** It is trivially spoofable by a determined user and is unreliable indoors, on desktops without GPS, and behind corporate VPNs. Geofencing is therefore specified as a **friction control** that catches casual policy violation, not as a security boundary or an attendance-fraud control. It must never be the only control protecting anything that matters.                                           |
| ID-15d         | Because of ID-15c, a geofence denial is **appealable**: the user can request a one-time bypass which routes to an administrator with the measured accuracy shown. Repeated denials for the same user with plausible accuracy are surfaced for review rather than treated as proof of anything.                                                                                                                                                                  |
| ID-15e         | Repeated denials across many users at one location indicate a misconfigured location, not mass policy violation, and raise a configuration alert.                                                                                                                                                                                                                                                                                                               |
| ID-16          | If the browser denies location access, or reports accuracy worse than the configured threshold, the login is denied with a specific, actionable message.                                                                                                                                                                                                                                                                                                        |
| ID-17          | Super Admin accounts are never geofenced. Locking out the root principal must not be possible.                                                                                                                                                                                                                                                                                                                                                                  |
| ID-18          | A temporary geofence bypass may be granted per user with a mandatory expiry of at most 7 days and a recorded reason.                                                                                                                                                                                                                                                                                                                                            |
| ID-18b         | **An approved Work From Home day suppresses geofencing entirely for that employee on that date** (§9.8a WFH-2). This is a distinct mechanism from the temporary bypass in ID-18: the bypass is an administrative exception with an expiry, whereas WFH is an approved working arrangement. On a WFH day no location is requested and none is stored.                                                                                                            |
| ID-19          | If session authentication uses cookies, CSRF protection is mandatory on every state-changing request.                                                                                                                                                                                                                                                                                                                                                           |
| ID-20          | Service accounts authenticate with scoped, rotatable API credentials. They never use a human's credentials.                                                                                                                                                                                                                                                                                                                                                     |

**Acceptance**

- A deactivated user's active session stops working within 60 seconds.
- A stolen refresh token, replayed after the legitimate client has rotated, revokes the family and alerts the user.
- A user holding payroll policy cannot complete login without a second factor.
- A geofenced user 200 m outside every assigned location cannot sign in, and the attempt is logged with the measured distance.

### 8.2 `organization` — Departments, Teams and Positions

**Purpose.** Hold the company's shape as data, so every other module can derive authority and reach from it rather than hard-coding a job title.

**Screens.** Departments · Teams · Position ladder (tree per department) · Position editor · Designations and specializations · Org chart

**Requirements**

| # Requirement  |                                                                                                                                                                                                                                                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OR-1           | Departments, teams and positions are created and edited from the UI. Adding a position never requires a deployment.                                                                                                                                                                                                   |
| OR-2           | The position ladder renders as a tree per department, with holder counts per position.                                                                                                                                                                                                                                |
| OR-3           | The org chart renders the actual reporting graph from `reportsTo`, not the position ladder, and highlights users with no manager set.                                                                                                                                                                                 |
| OR-4           | Custom positions obey constraints C-1 through C-7 (§3.7). Violations are rejected naming the specific conflict.                                                                                                                                                                                                       |
| OR-5           | A position in use by any active user cannot be deleted, only deactivated.                                                                                                                                                                                                                                             |
| OR-6           | Editing a position's policies takes effect immediately for every holder, who receives a live permission-change event.                                                                                                                                                                                                 |
| OR-7           | The position editor shows an **impact preview** before saving: how many users hold it, and a diff of capabilities added and removed.                                                                                                                                                                                  |
| OR-8           | The scope control renders a live plain-language sentence: *"A Sales Team Lead will see leads belonging to themselves and the 14 people in their team."*                                                                                                                                                               |
| OR-9           | Moving a user between teams changes their data boundary immediately and is audited.                                                                                                                                                                                                                                   |
| OR-10          | Reassigning a manager moves the individual only. Moving their reports as well requires explicit confirmation with a preview of every affected line.                                                                                                                                                                   |
| OR-11          | Designations and specializations are configuration, editable without a deployment, and never authorize anything.                                                                                                                                                                                                      |
| OR-12          | **Organizational visibility is split into three capabilities** so that seeing the shape of the company does not leak the access model: `org:view-structure` (departments, teams, position names, ladder), `org:view-people` (who holds what, who reports to whom), `org:view-policies` (what a position can do).      |
| OR-13          | Branch heads hold `org:view-structure` and `org:view-people` **scoped to their own department**, plus structure-only visibility of other departments so cross-department routing is possible. They do **not** hold `org:view-policies`; the access model is visible only to Super Admin and to `access:view` holders. |
| OR-14          | The org chart honours OR-13: the Sales Department Head sees the Sales tree in full and other departments as nodes with their head named, not expanded. A Project Manager, managing nobody, sees structure only.                                                                                                       |

**Acceptance**

- A new position can be created, given policies, and staffed end to end from the UI in under five minutes with no deployment.
- Creating a position at a level above its parent is rejected with the conflict named.
- The org chart lists every user whose `reportsTo` is unset.

### 8.3 `access-management` — Policies, Overrides and Delegation

**Purpose.** Make §4 operable by a person who is not an engineer.

**Screens.** Position policy editor · Employee assignment · Access explorer · Override panel · Role-change request queue · Delegation settings

**Requirements**

| # Requirement  |                                                                                                                                                                                                                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AM-1           | The policy editor lists every action grouped by module, each with a plain-language description of what it unlocks and which screens it reveals.                                                                                                                            |
| AM-2           | Each action carries its own scope selector. There is no position-wide scope control.                                                                                                                                                                                       |
| AM-3           | Protected capabilities (§4.7) render as locked, naming the governing constraint. A control that would silently fail is not shown as available.                                                                                                                             |
| AM-4           | The **access explorer** answers two questions. *Given a person:* their effective policy set, where each policy came from — position default or override — their subordinate set, and every screen they can reach. *Given a capability:* every person who holds it and why. |
| AM-5           | The second direction is mandatory. "Who can see payroll?" must be answerable in one query, not by reasoning about configuration.                                                                                                                                           |
| AM-6           | Overrides carry action, allowed, scope, optional field narrowing, a **required reason** and an optional expiry.                                                                                                                                                            |
| AM-7           | Expiry takes effect the moment it passes, because it is evaluated at authorization time. The nightly job performs cleanup and notification only, never the decision. Expiry and revocation are as auditable as the grant.                                                  |
| AM-8           | Changing a user's position clears their overrides, since an override is relative to a position.                                                                                                                                                                            |
| AM-9           | The overview flags every user with active overrides, showing the age of each. Overrides older than 180 days are surfaced for review.                                                                                                                                       |
| AM-10          | Where more than 30% of a position's holders carry the same override, the system recommends changing the position default instead. Advisory, not enforced.                                                                                                                  |
| AM-11          | Delegation obeys the four constraints in §4.5. The UI disables what cannot be granted and explains why on hover.                                                                                                                                                           |
| AM-12          | **Role-change requests**: HR and managers can request a position change for an employee. The request routes to Super Admin, who approves or rejects with a reason. Neither HR nor any manager can change a position directly.                                              |
| AM-13          | Every write in this module produces an audit record.                                                                                                                                                                                                                       |

**Acceptance**

- A Sales Team Lead cannot grant a capability they do not hold, and the UI explains why the control is disabled.
- Super Admin can grant one named Sales Team Lead visibility of one specific Supervisor's records, with a recorded reason, without changing any position.
- "Who can see payroll?" returns a correct and complete list.
- An override with a 30-day expiry stops taking effect on day 31 and both parties are notified.

### 8.4 `audit` — Trail, Integrity and Retention

**Purpose.** Make sensitive action reconstructable years later, and make tampering detectable.

**Screens.** Audit log with filters · Archived log search · Legal hold management · Integrity verification report

**Requirements**

| # Requirement  |                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AU-1           | Two streams. **Access audit**: permission grants, revocations, position changes, delegation, and every read of a protected resource. **Activity audit**: material business events — lead reassignment, disposition, deal creation and value change, approval decisions, brief decisions, delivery sign-off, change classification, payslip publication and revision, attendance and break decisions, employee status change, client credential operations. |
| AU-2           | Both streams are append-only. No principal, including Super Admin, can edit or delete an entry.                                                                                                                                                                                                                                                                                                                                                            |
| AU-3           | Entries are chained by cryptographic hash. Any modification or deletion breaks the chain and is reported by the integrity verification job, which runs daily.                                                                                                                                                                                                                                                                                              |
| AU-4           | Retention is **7 years as the product baseline**. This is a policy choice intended to cover the applicable statutory retention periods; exact obligations vary by record type and applicable law. Entries older than 12 months move to lower-cost archival storage, remaining searchable with higher latency.                                                                                                                                                                                                                                                                           |
| AU-5           | Archived entries are encrypted at rest with a separately managed key.                                                                                                                                                                                                                                                                                                                                                                                      |
| AU-6           | Only Super Admin queries the full audit log. HR queries the people-domain slice. Nobody else has audit access by default.                                                                                                                                                                                                                                                                                                                                  |
| AU-7           | Audit export is Super Admin only, is itself audited, and is rate-limited.                                                                                                                                                                                                                                                                                                                                                                                  |
| AU-8           | **Legal hold**: Super Admin can place a hold on a user, a client or a date range. Held entries are exempt from retention expiry until the hold is lifted. Placing and lifting a hold is audited.                                                                                                                                                                                                                                                           |
| AU-9           | Entries reaching the end of retention with no hold are deleted by a scheduled job which records what was deleted, in what range, and how many entries — the deletion itself being an audit event.                                                                                                                                                                                                                                                          |
| AU-10          | Every audit entry records actor, target, action, before and after values where applicable, timestamp, source address and the reason where one was required.                                                                                                                                                                                                                                                                                                |

**Acceptance**

- Modifying an audit row directly in storage is detected by the next integrity run and reported.
- A user under legal hold retains audit entries past the 7-year boundary.
- HR querying audit receives only people-domain entries.

### 8.5 `system-administration` — Settings and Configuration

**Purpose.** Everything an operator configures, in one place, with the blast radius of each change visible before it is made.

**Screens.** General settings · Approval thresholds · Notification rules · Integrations · Feature flags · Data retention policy · Backup and restore status

**Requirements**

| # Requirement  |                                                                                                                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SA-1           | **Approval thresholds** are configured per position: maximum deal value, maximum discount percentage, whether custom contract terms are permitted, and whether closing requires Sales Department Head contract sign-off. |
| SA-2           | A threshold change takes effect on the next evaluation and never retroactively invalidates an approved deal.                                                                                                             |
| SA-3           | A **high-visibility threshold** flags deals above a configured value to Super Admin for awareness even after approval. Visibility, not an approval step.                                                                 |
| SA-4           | Integration configuration for email, WhatsApp, payment gateway, calendar and webhooks, with connection tests and per-integration health status.                                                                          |
| SA-5           | Integration credentials are write-only from the UI. They are never displayed after entry.                                                                                                                                |
| SA-6           | Feature flags allow a module to be enabled per department or globally, so a capability can be rolled out gradually.                                                                                                      |
| SA-7           | Notification rules define which events notify which positions through which channels, editable without a deployment.                                                                                                     |
| SA-8           | Retention policies for audit, notifications, files, chat and archived records are configured here and enforced by scheduled jobs.                                                                                        |
| SA-9           | Backup status, last successful backup, and last verified restore are visible. A restore that has never been verified is reported as a risk.                                                                              |
| SA-10          | Bulk operations — import, mass update, mass delete — require a dry run that reports every error before anything is written, and above a configured row count require Super Admin approval.                               |

**Acceptance**

- Changing a Supervisor's discount ceiling changes escalation behaviour on the next deal, with no deployment.
- An integration credential cannot be read back through any interface.
- A bulk import of 5,000 rows with 12 invalid rows writes nothing and reports all 12.

---

## 9. Module Specifications — People

### 9.1 `employee-directory`

**Purpose.** The roster, and one place that answers any question about one person.

**Screens.** Directory grid · Add employee wizard · Employee 360 (tabbed)

**Requirements**

| # Requirement  |                                                                                                                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ED-1           | Employment status: `active`, `on-notice`, `inactive`, `terminated`, `absconded`. Status is never deleted; there is no hard delete of a user.                                             |
| ED-2           | Any status other than `active` blocks login, invalidates sessions, and removes the person from assignment pickers. Historical records remain intact and visible.                         |
| ED-3           | Employee ID is unique, uppercase and immutable after creation.                                                                                                                           |
| ED-4           | Position, department and team are required at creation. A user without a position cannot exist.                                                                                          |
| ED-5           | The add-employee wizard runs: identity → employment → work setup → compensation → access. The compensation step is skippable and gated by payroll policy.                                |
| ED-6           | The access step shows an **access preview**: exactly what this person will be able to see, derived from the chosen position. Access should not be discovered later.                      |
| ED-7           | The **360 view** has tabs — Overview, Attendance, Breaks, Leave, Payroll, Performance, Tasks, Work, Access, Documents — each independently authorized and each fetched only when opened. |
| ED-8           | A tab the viewer cannot access is not rendered and its data is never included in any response for the page.                                                                              |
| ED-9           | An employee viewing their own 360 sees every tab except Access.                                                                                                                          |
| ED-10          | Opening the Payroll or Documents tab on another employee writes an access-audit entry.                                                                                                   |
| ED-11          | Bulk import via file with a dry-run validation pass reporting every error before writing.                                                                                                |
| ED-12          | Directory records never expose compensation, statutory identifiers or permission policies to a `view`-scoped reader. Those are mandatory field policies (PD-3).                          |

**Acceptance**

- Creating an employee without a position is refused.
- A manager opening a subordinate's 360 sees no Payroll tab, and the payroll endpoint returns 403 if called directly.
- The access preview matches the permissions the user actually receives.

### 9.2 `onboarding` — Onboarding and Offboarding

**Purpose.** Turn joining and leaving into checklists with owners and due dates, so nothing is remembered late.

**Screens.** Workflow queue · Workflow detail · Template editor

**Requirements**

| # Requirement  |                                                                                                                                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ON-1           | Templates are configurable. Seeded onboarding: issue credentials, assign position/team/manager, assign shift, map biometric PIN, set break policy, collect documents, issue assets, manager introduction, set probation review date. |
| ON-2           | Seeded offboarding: set `on-notice`, reassign leads, reassign tasks, reassign direct reports, reassign account ownership, revoke access on last working day, collect assets, final settlement, exit interview, set `inactive`.       |
| ON-3           | An open onboarding workflow blocks nothing but remains on the HR dashboard until closed. A blocking checklist gets bypassed; a visible one gets finished.                                                                            |
| ON-4           | **Offboarding cannot complete** while the employee owns active leads, open tasks, direct reports or client accounts. Each is a named blocker linking to the reassignment screen.                                                     |
| ON-5           | Each step has an owner and a due date; overdue steps notify the owner and HR.                                                                                                                                                        |

**Acceptance**

- Offboarding a Supervisor with agents reporting to them is blocked until those agents are reassigned.
- Completing offboarding revokes access within 60 seconds and preserves all history.

### 9.3 `live-status`

**Purpose.** Who is at work right now, and in what state.

**Screens.** Live board · Employee day drawer

**Requirements**

| # Requirement  |                                                                                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| LS-1           | State machine per person per day: `NOT_IN → WORKING → ON_BREAK → WORKING → FINISHED`. Every transition writes an attendance event and updates the live projection in the same transaction. |
| LS-2           | Counts derive from the maintained live projection, never from scanning attendance history on request.                                                                                      |
| LS-3           | `NOT_IN` is not reported as absent until the person's shift start plus the configured grace has passed. Before that they are simply not yet due.                                           |
| LS-4           | People on approved leave or on a holiday for their shift appear in their own group, not counted absent.                                                                                    |
| LS-5           | A person over their break allowance is highlighted with the amount over. The board reports; a human decides.                                                                               |
| LS-6           | `FINISHED` is entered by explicit punch-out or by the auto-close job at shift end plus the configured window. Auto-closed days are flagged and enter the corrections queue.                |
| LS-7           | Flexible-shift employees show hours completed against the daily target instead of lateness.                                                                                                |
| LS-8           | The board updates by live event. Polling is a fallback engaged only after repeated connection failure.                                                                                     |
| LS-9           | This screen is strictly read-only. Corrections happen in `attendance`.                                                                                                                     |
| LS-10          | All times display in the organization's configured timezone regardless of the viewer's browser. Storage is UTC.                                                                            |

**Acceptance**

- A biometric punch appears on the board within 3 seconds.
- A sub-team manager's board contains exactly their sub-team.
- Times are identical for a viewer in IST and a viewer in UTC.

### 9.4 `attendance`

**Purpose.** The daily record, the arithmetic payroll consumes, and a repair path that never overwrites what the machine said.

**Screens.** Daily view · Weekly view · Monthly view · Day detail · Corrections queue · Correction form · My attendance

**Requirements**

| # Requirement  |                                                                                                                                                                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AT-1           | The calculated block on the attendance record is the only source for reporting. Nothing recomputes from raw events at read time.                                                                                                                                                                                          |
| AT-2           | Recalculation is triggered by a new punch, a correction, a shift change affecting a past date, a leave approval affecting a past date, a break decision, or an explicit request. It is idempotent and versioned.                                                                                                          |
| AT-3           | **Status precedence**, highest first: Holiday → Approved full-day leave → Approved half-day leave → Present → Half-day by hours → Absent. This order is fixed and unit-tested. A later rule can never silently invert an earlier one. WFH is **not** in this list: it is a flag on a present day, not a competing status. |
| AT-4           | Lateness is first punch-in minus effective shift start minus grace. Never negative. Flexible shifts are exempt.                                                                                                                                                                                                           |
| AT-5           | Overtime accrues past the shift duration **and** past a configured minimum, and only on working days.                                                                                                                                                                                                                     |
| AT-6           | A correction never mutates a device event. It appends a manual event and records the supersession. The device's version remains readable permanently.                                                                                                                                                                     |
| AT-7           | A correction requires a reason of at least 20 characters, shown in the day detail, the audit log and every export.                                                                                                                                                                                                        |
| AT-8           | Employees may **request** a correction to their own day; only authorized reviewers apply one. Absolute constraint A1 applies.                                                                                                                                                                                             |
| AT-9           | Approving a correction triggers recalculation and, where the date falls in a published payroll period, flags the payslip as requiring regeneration rather than altering it.                                                                                                                                               |
| AT-10          | Corrections to dates older than 60 days require Super Admin.                                                                                                                                                                                                                                                              |
| AT-11          | Bulk correction is supported for one date across many employees — the device-outage case — with one shared reason.                                                                                                                                                                                                        |
| AT-12          | Every displayed value exposes its provenance on hover: which shift applied, which punches produced it, whether it was corrected and by whom, and whether the day was worked remotely.                                                                                                                                     |
| AT-12b         | An approved WFH day is `present` with `isWFH = true`, evaluated against the employee's normal shift in every respect (§9.8a). It is never a status of its own competing with present or absent, because the person was working.                                                                                           |
| AT-13          | A requested range longer than 92 days is refused with a pointer to export.                                                                                                                                                                                                                                                |
| AT-14          | Export is a separately authorized capability from viewing, and every export is audited.                                                                                                                                                                                                                                   |

**Acceptance**

- Deleting a punch and recalculating restores the pre-punch values exactly.
- Monthly totals equal payslip totals for every employee across a three-month regression set.
- After a correction, the original device events remain retrievable and are visibly marked superseded.

### 9.5 `break-management`

**Purpose.** Breaks are measured; this module governs them. Super Admin and HR set an upper and a lower limit per employee and attach consequences when either is breached.

**Design position.** This module **decides**; `attendance` **calculates**. A penalty produces a flag; it never writes hours. Keeping them separate is what stops a policy change silently rewriting the ledger payroll reads.

**Screens.** Policy list · Policy editor · Assignments · Breach queue · Break analytics · *(employee-facing: allowance on the punch widget)*

**Limits**

| Setting Meaning         |                                        |
| ----------------------- | -------------------------------------- |
| `upperTotalMinutes`     | Maximum total break time in a shift    |
| `upperSingleMinutes`    | Maximum length of any one break        |
| `upperCount`            | Maximum number of breaks in a shift    |
| `lowerTotalMinutes`     | Minimum break the employee should take |
| `lowerEnforced`         | `advisory` (default) or `required`     |
| `graceMinutes`          | Tolerance before a breach is recorded  |
| `countsTowardWorkHours` | Whether break time is paid             |

**Penalty rules** — an ordered list, each a condition and a consequence.

| Condition type Consequence type                          |                                                                                                                                 |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `over-total`, `over-single`, `over-count`, `under-total` | `warn`, `require-explanation`, `notify-manager`, `mark-late`, `mark-half-day`, `mark-absent`, `deduct-minutes`, `deduct-amount` |

Conditions support occurrence counting: per-day, cumulative per week, cumulative per month — *"the third time this month, mark half-day."*

**Requirements**

| # Requirement  |                                                                                                                                                                                                                                                                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BM-0           | **The product ships with no break policy and therefore no limits.** Breaks are recorded but not governed until a Super Admin or HR creates the first policy. There are no seeded numbers, because a seeded limit is a limit nobody agreed to that starts penalising people on day one.                                             |
| BM-0b          | The policy editor supports both **bulk assignment** — every employee, a whole department, a position, a shift or a team in one action — and **individual assignment**, with the most-specific rule in BM-1 deciding which applies. Setting a company-wide baseline and then overriding three named people is a two-step operation. |
| BM-1           | Limits may be set per department, position, shift, team or **named individual**. Where several policies match, the **most specific wins**: individual → team → shift → position → department. Ties break on explicit priority. The resolved policy is shown on the employee's record.                                              |
| BM-2           | A grace period applies before any breach is recorded. Someone two minutes over an hour has not done anything the company should act on, and a system that says otherwise trains people to ignore it.                                                                                                                               |
| BM-3           | The lower limit exists for welfare and working-time compliance and **defaults to advisory**. Setting it to required is permitted but is the unusual case, and the interface says so.                                                                                                                                               |
| BM-4           | Penalty rules are evaluated in order and the **first match wins**. Rules do not stack. Two consequences for one breach is almost always a misconfiguration.                                                                                                                                                                        |
| BM-5           | Any consequence that changes attendance status or deducts pay **requires human confirmation by default**. The breach is created pending review and appears in the queue; nothing is written to attendance until confirmed.                                                                                                         |
| BM-6           | Auto-apply is available per rule, is shown in the interface as "applies automatically", and is audited. The default is review because the cost of a wrong auto-applied absent mark is an employee losing a day's pay, discovered on payday; the cost of the review step is a few minutes of HR's day.                              |
| BM-7           | A penalty **never** edits punch data or break sessions. It writes a flag and a breach record. This is what makes a waiver a clean reversal.                                                                                                                                                                                        |
| BM-8           | Waiving requires a reason, reverses any applied consequence, and triggers recalculation. If the period is already paid, the payslip is flagged rather than altered.                                                                                                                                                                |
| BM-9           | Absolute constraint A1 applies: nobody reviews a breach on their own record.                                                                                                                                                                                                                                                       |
| BM-10          | A deduction produces a **payroll input**, appearing as a named line on the payslip so the employee can see what it was for.                                                                                                                                                                                                        |
| BM-11          | Employees can always see their resolved limit, usage today and remaining allowance. A limit an employee cannot see is a trap, not a policy.                                                                                                                                                                                        |
| BM-12          | **Warnings fire before the breach**, at configurable percentages of the limit — 80% by default. The purpose of this module is fewer breaches, not more penalties.                                                                                                                                                                  |
| BM-13          | A `require-explanation` consequence prompts the employee on next login; the note attaches to the breach. Often the explanation ends the matter, and asking is cheaper than penalizing.                                                                                                                                             |
| BM-14          | **Status precedence is unchanged.** A break penalty cannot override a holiday or approved leave. Where it would, the breach is recorded and the consequence is suppressed with the reason "superseded by leave".                                                                                                                   |
| BM-15          | Flexible-shift employees are evaluated on total break time only. Lateness-style consequences do not apply, since they have no shift window.                                                                                                                                                                                        |
| BM-16          | A policy change **never** applies retroactively. It takes effect from its effective date. Re-evaluating history is available as an explicit **preview that writes nothing**.                                                                                                                                                       |
| BM-17          | Breaches feed performance aggregates and appear on the 360 Attendance tab.                                                                                                                                                                                                                                                         |

**Acceptance**

- A policy assigned to one named employee overrides the department policy, and the resolved policy is shown on their record.
- Exceeding a 60-minute limit by 3 minutes with a 5-minute grace produces no breach.
- A `mark-half-day` consequence requiring approval creates a pending breach and does not change attendance until confirmed.
- Waiving a confirmed breach restores attendance exactly and flags any published payslip.
- An employee on approved half-day leave who breaches gets a recorded breach with the consequence suppressed.
- A "third time this month" rule fires on the third occurrence, not the second, and the counter resets on the 1st.

### 9.6 `shifts`

**Purpose.** Define shift patterns, assign them, and handle exceptions without the exception logic leaking into attendance calculation.

**Screens.** Templates · Assignment board · Request queue

**Effective shift resolution**, in strict precedence order:

1. Date-specific override on the user
2. Permanent-flexible flag
3. Approved flexible request for that date
4. Weekly rotation entry for that weekday
5. Assigned shift template
6. Department default
7. No shift — attendance recorded but not evaluated

**Requirements**

| # Requirement  |                                                                                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SH-1           | The resolution chain is implemented once and every consumer calls it. The live board, the attendance service and the payroll job must never disagree about which shift applied. |
| SH-2           | Changing a template does not retroactively change past attendance. Attendance records store the resolved shift snapshot for their date.                                         |
| SH-3           | **Overnight shifts** attribute the whole session to the date the shift started. This is the most regression-prone rule in the product and has a dedicated test suite.           |
| SH-4           | Permanent-flexible employees have a daily hours target, not a window: under 5h absent, 5h to under 8h half-day, 8h or more full day.                                            |
| SH-5           | A template in use cannot be deleted, only deactivated.                                                                                                                          |
| SH-6           | A shift change effective in the past requires attendance-correction authority and triggers recalculation for the affected range.                                                |
| SH-7           | Absolute constraint A1: nobody approves their own request.                                                                                                                      |

**Acceptance**

- A 22:00–07:00 shift records the full session on the start date with correct lateness and no double counting.
- Editing a template alters no prior attendance record.

### 9.7 `biometric`

**Purpose.** Register terminals, map their PINs to people, and make device health visible before an outage becomes a payroll dispute.

**Screens.** Device registry · Device detail · PIN mapping · Punch stream

**Requirements**

| # Requirement  |                                                                                                                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BI-1           | The device ingest endpoint accepts pushes only from registered, enabled serial numbers. Everything else is logged and discarded.                                                       |
| BI-2           | Biometric PIN is unique. Assigning a PIN already held reports the conflicting person by name.                                                                                          |
| BI-3           | A punch from an unmapped PIN is **stored**, never dropped. Mapping the PIN later makes the preceding 30 days replayable in one action.                                                 |
| BI-4           | Device clock skew is measured at each handshake. Skew beyond ±3 minutes raises an alert; the stored offset is applied at ingest so a drifting device does not create phantom lateness. |
| BI-5           | Dry-run mode ingests and logs without writing attendance. This is how a device is commissioned.                                                                                        |
| BI-6           | Duplicate punches — same PIN, same device, within 60 seconds — collapse to one and are logged as duplicates.                                                                           |
| BI-7           | A device silent for 60 minutes during any assigned shift window raises an alert and notifies device administrators.                                                                    |
| BI-8           | The punch stream shows every punch with status: applied, rejected, duplicate, unmapped — with the reason. Failed punches are replayable.                                               |

**Acceptance**

- A punch from an unregistered serial is rejected and logged.
- Mapping a PIN and replaying produces correct historical attendance.
- A device 5 minutes fast produces no false lateness once the offset is set.

### 9.8 `leave`

**Purpose.** Request, route, decide and account for absence.

**Screens.** Queue · Calendar · Balances · My leave · Leave type configuration

**Approval routing**

| Stage Who Can they decide?  |                         |                                                                                                                         |
| --------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1                           | The requester's manager | **No.** Acknowledge or flag an availability conflict only. Auto-advances after 24 hours with the non-response recorded. |
| 2                           | HR                      | **Yes.** Approves or rejects on policy and balance.                                                                     |

The manager stage exists because a manager who first learns of an absence from the attendance report will route around the system. It is visibility, not a gate.

**Requirements**

| # Requirement  |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LV-1           | Leave types are configuration: code, name, paid, requires document, maximum consecutive days, accrual rate, carry-forward cap, encashable, probation eligibility.                                                                                                                                                                                                                                                                                                                                                                                                   |
| LV-1b          | **Work From Home is not a leave type.** It is an **attendance mode** (§9.4a) that uses the leave module's request-and-approve machinery because that machinery already exists, but produces an entirely different effect: the employee works, is present, and consumes no balance. It is configured as `kind: attendance-mode` rather than `kind: absence`, and every rule below that mentions balance, entitlement or absence does not apply to it.                                                                                                                |
| LV-2           | Balance is checked at request time and **deducted at approval**, not at request. Rejections and cancellations restore it.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| LV-3           | Holidays and configured week-offs inside a leave period consume no balance and are not counted as leave days.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| LV-4           | Half-day leave is a first-class period type, not two records.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| LV-5           | Approval writes a leave overlay onto the affected attendance records and triggers recalculation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| LV-6           | Protected constraint P4: attachments are readable by HR only. The acknowledging manager sees dates, type and the fact of a document — never its contents.                                                                                                                                                                                                                                                                                                                                                                                                           |
| LV-7           | Absolute constraint A1: no self-approval at any level.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| LV-8           | Overlapping requests for the same person and date are rejected at submission with a pointer to the conflict.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| LV-9           | Retroactive leave is permitted, flagged, requires a reason, and flags any affected published payslip.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| LV-10          | The employee always sees **which named person** the request is waiting on. "Pending" without a name is the largest single source of HR follow-up traffic.                                                                                                                                                                                                                                                                                                                                                                                                           |
| LV-11          | The balance ledger reconciles: opening + accrued − consumed = closing, for every person and period.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| LV-12          | **Leave types ship with** **`accrual = 0`** **and balance enforcement off.** Requests are recorded, acknowledged, approved and reflected on attendance; nothing is deducted, because no entitlement is configured. HR turns enforcement on by entering a value for **every** seeded type — partial configuration is refused, since a half-filled policy silently denies leave for the unfilled types. Until then a persistent banner states that balances are not tracked, and the go-live checklist lists it as a blocker. See `DECISIONS.md` BD-5 LV-G1 to LV-G5. |

**Acceptance**

- A leave raised by an agent notifies their Supervisor for acknowledgement and routes to HR for the decision; the Supervisor's approve control does not exist and the endpoint returns 403 for them.
- A holiday inside a 5-day leave consumes 4 days of balance.
- Balances reconcile across a 12-month simulation.

### 9.8a Work From Home

**Purpose.** Let an approved employee work a normal shift from anywhere, without the location controls that assume they are at an office, and without the record pretending they were absent.

**Screens.** Request WFH *(in* *`/leave/mine`**)* · WFH approvals *(in the leave queue)* · WFH day on the attendance calendar

**Requirements**

| # Requirement  |                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WFH-1          | A WFH request names a date or a date range and routes through the same two-stage path as leave: manager acknowledgement, then HR decision. Only the request needs approving; nothing else about the day changes.                                                                                                                                                                      |
| WFH-2          | **On an approved WFH day, geofencing does not apply to that employee for that date.** They may punch in from anywhere. The geofence evaluation is skipped, not merely widened, so there is no location to breach and no coordinates are captured.                                                                                                                                     |
| WFH-3          | The employee punches in and out manually from the web or mobile app. Their **normal shift window still applies**: lateness, early departure, break limits, overtime and the auto-close job all behave exactly as they would in the office. WFH changes *where*, not *when*.                                                                                                           |
| WFH-4          | The day is recorded as **present**, with `isWFH = true`. It consumes no leave balance, counts as a working day for payroll, and counts toward attendance percentage.                                                                                                                                                                                                                  |
| WFH-5          | The WFH flag propagates to every consumer: the live status board shows a WFH badge instead of an office location, the attendance portal and day detail show it, the monthly summary counts it separately from office days, the payslip treats it as a normal paid working day, and performance aggregates report WFH days as a distinct figure rather than folding them into absence. |
| WFH-6          | An unapproved WFH punch is refused for a geofenced employee — that is the geofence doing its job — and is accepted but flagged for a non-geofenced employee, appearing in the attendance corrections queue as "worked remotely without an approved request".                                                                                                                          |
| WFH-7          | A WFH day and a leave day are mutually exclusive. Approving leave over an approved WFH date supersedes the WFH and notifies the employee.                                                                                                                                                                                                                                             |
| WFH-8          | WFH can be granted as a standing arrangement — a permanent or recurring pattern such as every Friday — rather than one request per day. A standing arrangement is a single approved record with a recurrence rule and an end date, reviewable by HR.                                                                                                                                  |
| WFH-9          | A biometric punch on an approved WFH day is accepted and clears the WFH flag for that date, because the person evidently came in. The approval is not consumed.                                                                                                                                                                                                                       |
| WFH-10         | WFH days are reportable per employee, per team and per department, since the whole point of tracking them is to know how much of the workforce is remote on any given day.                                                                                                                                                                                                            |

**Acceptance**

- A geofenced employee with an approved WFH day punches in successfully from a location 500 km outside every assigned geofence, and no coordinates are stored for that punch.
- The same employee on a non-WFH day is refused from the same location.
- A WFH day appears as present on the attendance portal, consumes no leave balance, and is paid as a normal working day.
- Lateness on a WFH day is calculated identically to an office day.
- A biometric punch on an approved WFH day clears the flag for that date.

### 9.9 `holidays`

**Purpose.** One authoritative calendar, aware that a night-shift employee's holiday is not the same 24 hours as a day-shift employee's.

**Requirements**

| # Requirement  |                                                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HO-1           | Types: national (all), regional (selected departments), optional (employee may claim against a quota), week-off (recurring).                            |
| HO-2           | A holiday may be scoped to specific shifts. Empty means all shifts.                                                                                     |
| HO-3           | Declaring a holiday on a date with existing attendance does not erase it. People who worked are marked holiday-worked and become eligible for comp-off. |
| HO-4           | The calendar is published read-only to every employee.                                                                                                  |

### 9.10 `payroll`

**Purpose.** Turn the attendance ledger into a payslip automatically, let a human fix what the automation got wrong, and never change a published payslip.

**Screens.** Cycle dashboard · Run and review grid · Salary structures · Payslip register · My payslips · Statutory configuration

**Requirements**

| # Requirement  |                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PY-1           | A run executes against a **frozen attendance snapshot** taken when the run starts. Later corrections do not silently change a run in progress; they flag it.                                                                                                                                                                                                                                                                             |
| PY-2           | Paid days = total days − loss of pay. LOP derives from unpaid-leave days and unapproved-absence days only.                                                                                                                                                                                                                                                                                                                               |
| PY-3           | Proration is by paid days over total days, applied per component, **rounded once at the component level**. Rounding only at the total is what produces one-rupee discrepancies.                                                                                                                                                                                                                                                          |
| PY-4           | Statutory calculations are configuration-driven and **versioned by effective date**. A rate change applies forward and never retro-alters published payslips.                                                                                                                                                                                                                                                                            |
| PY-5           | A **published payslip is immutable**. A correction is issued as a linked revision; both are retained and the employee is notified with the reason.                                                                                                                                                                                                                                                                                       |
| PY-6           | Protected constraint P2: readable by the subject and by `payroll:manage` holders only.                                                                                                                                                                                                                                                                                                                                                   |
| PY-6b          | **`payroll:view`** **at** **`all-people`** **does not grant payslip access.** It grants access to the payroll *module* — cycle status, run progress, aggregate cost. Reading an individual payslip requires either being its subject or holding `payroll:manage`. An HR Executive holding `all-people` on the directory therefore reads no payslips at all. This is a mandatory field policy (PD-3) and cannot be widened by delegation. |
| PY-7           | A run cannot publish while any employee in it has an unresolved attendance correction or break breach for the period.                                                                                                                                                                                                                                                                                                                    |
| PY-8           | The review grid shows a **variance column against the previous period, sorted by absolute variance descending**, so the outliers are what a reviewer sees first.                                                                                                                                                                                                                                                                         |
| PY-9           | Break deductions and other adjustments appear as named lines.                                                                                                                                                                                                                                                                                                                                                                            |
| PY-10          | Generation runs as a background job with progress reporting. A failed run leaves no partial payslips.                                                                                                                                                                                                                                                                                                                                    |
| PY-11          | **Publishing a payroll run posts a journal entry**: debit Salary Expense, credit Salary Payable (§13.6 LG-4). The posting is automatic and balanced.                                                                                                                                                                                                                                                                                     |
| PY-12          | **HR cannot read the ledger it posts to.** Protected constraint P7 makes payroll a one-way producer of accounting entries. HR sees the payroll run and the payslips; HR does not see the general ledger, the profit and loss account, or any other department's costs.                                                                                                                                                                   |

**Acceptance**

- Generated paid days match the attendance portal for all employees.
- A published payslip cannot be edited by any principal including Super Admin; only revised.
- An attendance correction after publication flags the payslip and notifies payroll without altering it.

### 9.11 `performance`

**Purpose.** Give HR and managers a performance record built from what the system already knows, rather than from a form someone fills in from memory.

**Screens.** Performance overview · Employee performance record · Review cycle management

**Requirements**

| # Requirement  |                                                                                                                                                                                                                                                                                                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PF-1           | KPIs are **derived**, not entered. Sales roles: leads worked, conversion rate, handovers initiated or accepted, deals closed and value, callback adherence. Delivery roles: tasks completed, on-time rate, revision rate, time logged against estimate. All roles: attendance rate, punctuality, break-breach count, leave utilization.                                |
| PF-2           | **HR sees derived values without gaining access to the underlying records.** HR sees that an agent closed 14 deals worth a total; HR cannot open a deal. The aggregate is computed server-side and delivered as a number; the HR principal never queries the deals collection. This is the one place people data and business data meet, and it meets as an aggregate. |
| PF-3           | A manager sees their own team's performance records. They do not see other teams'.                                                                                                                                                                                                                                                                                     |
| PF-4           | Review cycles are configurable: annual, half-yearly, probation, project-based.                                                                                                                                                                                                                                                                                         |
| PF-5           | Absolute constraint A1: nobody writes their own review.                                                                                                                                                                                                                                                                                                                |
| PF-6           | Project participation history is retained per project after closure, with the project's outcome attached.                                                                                                                                                                                                                                                              |
| PF-7           | A review is visible to its subject once published. Draft reviews are not.                                                                                                                                                                                                                                                                                              |

**Acceptance**

- HR sees an agent's deal-value aggregate and receives 403 on the underlying deal endpoint.
- A sub-team manager sees only their own sub-team's records.

---

## 10. Module Specifications — Sales

### 10.1 `territories`

**Purpose.** Define how the market is divided, so lead routing is a rule rather than a habit, and so a Team Lead's boundary means something concrete.

**Screens.** Territory list · Territory editor · Routing rules · Coverage map

**Requirements**

| # Requirement  |                                                                                                                                                                                                                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TR-0           | **Most leads are agent-sourced.** An agent doing outbound work — cold calling, email, LinkedIn, personal contacts — creates the lead and owns it immediately. No routing is involved and no territory applies. This is the common path and it must stay frictionless.                        |
| TR-0b          | **The product ships with no territories configured.** Territory division is available but not required, and is off by default.                                                                                                                                                               |
| TR-1           | Where territories are used, one is defined by any combination of geography, industry vertical, product line and lead source.                                                                                                                                                                 |
| TR-2           | Each territory is assigned to exactly one sales team. A team may hold several territories.                                                                                                                                                                                                   |
| TR-3           | **Routing applies only to unassigned inbound leads** — website forms, social messages, ad landing pages, referrals. Such a lead routes to a team by territory where territories exist, then to an agent within that team.                                                                    |
| TR-3b          | The default agent-assignment strategy is **load-balanced by open lead count**, so a lead goes to whoever currently has the fewest. This self-corrects when someone is on leave or overloaded, without anyone maintaining a rota. Round-robin and manual queue are configurable alternatives. |
| TR-3c          | Load balancing counts only agents who are active and punched in. Routing a lead to someone who is not at work is how a lead goes cold on day one.                                                                                                                                            |
| TR-4           | A lead matching no territory, or arriving when no agent is available, lands in an unrouted queue visible to the Sales Department Head and Supervisors, never silently unassigned.                                                                                                            |
| TR-5           | Reassigning a territory between teams moves future leads only. Existing leads move only by explicit bulk reassignment, which is audited.                                                                                                                                                     |
| TR-6           | Territory and source performance — leads, conversion, revenue — is a standard report, and is meaningful even with no territories configured because source attribution is always recorded.                                                                                                   |

**Acceptance**

- An agent creating their own lead owns it immediately, with no routing step.
- With no territories configured, an inbound website lead routes to the active, punched-in agent holding the fewest open leads.
- An inbound lead arriving when no agent is available appears in the unrouted queue within seconds rather than being assigned to someone who is off.

### 10.2 `leads`

**Purpose.** Every lead: where it came from, whose it is, and what state it is in.

**Screens.** List · Pipeline board · Add lead · Lead detail · Lost-lead review · Re-engagement segments · Unrouted queue

**Lead status**

`New` → `Assigned` → `Contacted` → `Discovery` → `Proposal Sent` → `Follow-up` → `Handed Over` → `Callback Scheduled` → `Converted` | `Closed Lost` | `Nurture`

**Requirements**

| # Requirement  |                                                                                                                                                                                                                 |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LD-1           | Every lead has exactly one owning agent. Ownership drives scope and **survives handover** — the agent keeps the lead even when a Supervisor takes over the call.                                                |
| LD-2           | Lead sources are configuration, carrying the inbound/outbound distinction and an optional campaign, which is what makes attribution reporting possible.                                                         |
| LD-3           | **An agent cannot reassign their own lead.** They may request reassignment; the Supervisor decides.                                                                                                             |
| LD-4           | `Converted` and `Closed Lost` are set by the disposition and deal flow, never typed by hand.                                                                                                                    |
| LD-5           | Lost leads are retained with a structured reason and become available to marketing re-engagement as an **anonymized segment** — counts and attributes, not contact records, since marketing has no lead access. |
| LD-6           | Re-engagement producing a fresh inquiry creates a **new** lead linked to the old one.                                                                                                                           |
| LD-7           | A lead whose callback is missed or which stalls beyond a configured number of days **auto-flags to the Supervisor** for reassignment or move to nurture. This is a scheduled job, not a manual review.          |
| LD-8           | Duplicate detection on phone and email at creation warns the creator and names the existing owner. Not a hard block — the same business genuinely calls twice — but never silent.                               |
| LD-9           | The activity timeline records every event: created, assigned, called, callback set, handed over, disposition recorded, deal created, reassigned.                                                                |
| LD-10          | Bulk import with dry-run validation, owner assignment and source tagging.                                                                                                                                       |

**Acceptance**

- An agent's list contains only their own leads, verified by direct API call as well as through the interface.
- A Supervisor sees exactly their pool; a Team Lead sees every pool beneath them and no other team's.
- An agent's attempt to reassign returns 403.
- A lead stalled past the threshold appears in the Supervisor's queue without anyone running a report.

### 10.3 `callbacks`

**Purpose.** Scheduled follow-ups with reminders that actually arrive. A missed callback is lost revenue, so the notification path is as much the product as the record is.

**Screens.** List · Calendar · Board · Schedule callback · Callback detail

**Status:** `Pending`, `Completed`, `Rescheduled`, `Not Reachable`, `Missed`, `Cancelled`

**Requirements**

| # Requirement  |                                                                                                                                                                                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CB-1           | A callback always belongs to a lead. There are no orphans.                                                                                                                                                                   |
| CB-2           | **A callback set during a handover is assigned back to the originating agent**, not to the Supervisor or Team Lead who set it. The agent is notified with full context and works the call, re-entering the disposition flow. |
| CB-3           | Reminder ladder: T−60 minutes, T−15 minutes, and at T. Delivered in-app, by push, and optionally by WhatsApp or email.                                                                                                       |
| CB-4           | **Delivery is recorded per channel**, so "I never got the reminder" is answerable.                                                                                                                                           |
| CB-5           | A callback whose time passes without an outcome becomes `Missed` after a 30-minute grace and notifies the agent and their Supervisor.                                                                                        |
| CB-6           | Rescheduling creates a **new** callback linked to the original, so slippage is visible rather than overwritten.                                                                                                              |
| CB-7           | Recording an outcome is mandatory to close a callback.                                                                                                                                                                       |
| CB-8           | All times are in the organization's configured timezone.                                                                                                                                                                     |

**Acceptance**

- A callback set by a Supervisor during a handover is owned by the originating agent and appears on the agent's list.
- A callback 61 minutes out fires exactly three reminders.
- An unactioned callback becomes `Missed` 30 minutes after its time.

### 10.4 `handovers`

**Purpose.** The live-call escalation at the centre of the sales process: an agent has an interested customer and a Supervisor or Team Lead takes over the call.

**Screens.** All handovers · Incoming offers · My handovers · Handover detail

**Requirements**

| # Requirement  |                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HV-1           | **Valid targets are every active Supervisor and Team Lead in the Sales department, regardless of team.** Handover is driven by **availability, not by reporting line**: an interested customer is on the phone, and the person who can take that call is whoever is free. An agent under Team Lead A may hand over to a Supervisor under Team Lead B.                                                                         |
| HV-1b          | The only eligibility rule is position and status: the target holds `handovers:receive`, is active, and is punched in. There is no reporting-chain restriction and no level threshold.                                                                                                                                                                                                                                         |
| HV-1c          | The consequence is that a deal can be **cross-team**: originated by one team's agent, closed by another team's supervisor. §10.5 DL-12 defines how such a deal is attributed and who sees it.                                                                                                                                                                                                                                 |
| HV-2           | **Availability routing.** The handover screen shows every eligible target with live availability — working, on break, not punched in — plus handovers accepted in the last hour, ordered so the most available appear first. The agent's own Supervisor and Team Lead are shown in a pinned group at the top, because they are the usual choice, but they carry no special privilege and can be passed over when unavailable. |
| HV-2b          | Targets who are not punched in are shown but not selectable, with the reason stated. Showing them prevents the agent hunting for someone the system has silently hidden.                                                                                                                                                                                                                                                      |
| HV-3           | A handover is **offered, not imposed**. The target accepts or declines with a reason. An offer unanswered for the configured window expires and the agent is prompted to choose another target.                                                                                                                                                                                                                               |
| HV-4           | **Disposition** is recorded by whoever accepted, and is exactly one of: `ACCEPTED` (creates a deal; threshold check runs; protected constraint P1 engages), `REJECTED` (structured reason; lead to Closed Lost, retained for re-engagement), `CALLBACK` (creates a callback **owned by the originating agent**).                                                                                                              |
| HV-5           | Client details and callback details may be entered by **either** the agent or the person who took the handover. Deal commercials may be entered only by the person who took it, or above.                                                                                                                                                                                                                                     |
| HV-6           | A Supervisor may hand a live call onward to any Team Lead when the call needs seniority they do not have. Same mechanism, same record — otherwise it happens by phone and the record is lost.                                                                                                                                                                                                                                 |
| HV-7           | Time-to-accept and time-to-outcome are recorded. These are the two numbers a Team Lead needs to run the floor.                                                                                                                                                                                                                                                                                                                |
| HV-8           | A handover cannot be edited or deleted after a disposition. Corrections are appended as annotations.                                                                                                                                                                                                                                                                                                                          |
| HV-9           | If every eligible target is unavailable, the agent may place the handover in a **team queue**, which alerts all eligible targets and is claimed by the first responder.                                                                                                                                                                                                                                                       |

**Acceptance**

- An agent's target list contains every active, punched-in Supervisor and Team Lead in Sales, with their own pinned at the top.
- A handover from an agent under Team Lead A to a Supervisor under Team Lead B succeeds, and the resulting deal is visible to both Team Leads (DL-12).
- An unanswered offer expires at the configured window and the agent is re-prompted.
- A `CALLBACK` disposition creates a callback owned by the agent.
- An `ACCEPTED` disposition creates a deal and runs the threshold check with no manual step.

### 10.5 `deals`

**Purpose.** The commercial record — what was sold, on what terms, approved by whom, and paid when.

**Screens.** Deal list · Pipeline board · Deal detail (Commercials · Scope · Approvals · Documents · Activity) · Wins to record · Forecast

**State model.** A deal carries **five orthogonal state dimensions**. Collapsing them into one pipeline stage produces values like "Refunded" and "Contract Signed" sitting inside a sales pipeline, which is a category error and makes every filter and report ambiguous.

| Dimension Values Answers  |                                                                  |                                          |
| ------------------------- | ---------------------------------------------------------------- | ---------------------------------------- |
| `dealStage`               | `discovery` · `proposal` · `negotiation` · `closed`              | Where is this in the sales conversation? |
| `approvalStatus`          | `not-required` · `pending` · `approved` · `rejected`             | Has commercial authority been granted?   |
| `contractStatus`          | `not-required` · `draft` · `sent` · `signed`                     | Where is the paperwork?                  |
| `paymentStatus`           | `unpaid` · `partial` · `advance-confirmed` · `paid` · `refunded` | What money has arrived?                  |
| `lifecycleStatus`         | `open` · `won` · `lost` · `cancelled`                            | What is the commercial outcome?          |

**`lifecycleStatus = won`** **is a controlled state, not a value anyone sets directly.** The system permits the transition only when all of the following hold:

```
  approvalStatus  ∈ { not-required, approved }
  AND contractStatus ∈ { not-required, signed }
  AND paymentStatus  ∈ { advance-confirmed, paid }
  AND dealStage      = closed

```

A deal failing any predicate cannot become `won`, and the interface names the specific unmet condition rather than disabling the control silently.

**Advance payment confirmation** is a distinct, separately authorized act: `deals:confirm-payment`. It sets `paymentStatus = advance-confirmed` and is held by the Sales Department Head. It is explicitly **not** implied by `deals:record-win` — recording the win and confirming the money are different assertions, and one person doing both is a segregation concern the register raises for decision (see `DECISIONS.md` BD-18).

**Sequence.** The stages in §7 map onto these dimensions as follows:

```
  Stage 1  disposition ACCEPTED   → deal created, dealStage = negotiation
  Stage 2  threshold check        → approvalStatus pending → approved
           contract where required → contractStatus draft → sent → signed
  Stage 3  payment confirmed      → paymentStatus advance-confirmed
           Sales Department Head records the win → dealStage closed, lifecycleStatus won
  Stage 4  brief compiled         → requires lifecycleStatus won

```

Cancellation and refund after `won` set `lifecycleStatus = cancelled` and `paymentStatus = refunded`. They never rewind `dealStage`, because the sales conversation did in fact reach closure and the history should say so.

**Requirements**

| # Requirement  |                                                                                                                                                                                                                                                                                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DL-1           | A deal is created from a lead when `ACCEPTED` is recorded, or directly by a Supervisor and above for a deal that arrived without the agent path. Both routes record the origin.                                                                                                                                                                                                |
| DL-2           | **Any level can close** within its configured limit. The threshold check runs automatically on creation and on every change to value, discount or terms, setting `approvalStatus` accordingly.                                                                                                                                                                                 |
| DL-3           | Protected constraint P1 is **field-level**: where the originating agent did not close the deal, the `commercials` object is **omitted** from their response — omitted, not nulled.                                                                                                                                                                                             |
| DL-3a          | **Attribution and monetary value are two different disclosures and are governed separately.** The agent always sees: the deal exists, its `dealStage`, its `lifecycleStatus`, and that they hold sourcing credit for it. The agent never sees, unless BD-9 is explicitly enabled by Super Admin: deal value, discount, payment amounts, contract terms, or negotiation detail. |
| DL-3b          | Knowing *that* you are credited is not knowing *how much*. Conflating the two is what would make BD-9 a contradiction instead of a decision, so the two disclosures carry separate field policies and BD-9 toggles only the second.                                                                                                                                            |
| DL-3c          | Where BD-9 is enabled, it exposes exactly one derived field — `creditedValue` — and does not expose discount, payment schedule, contract terms or negotiation history. It is a narrower disclosure than lifting P1.                                                                                                                                                            |
| DL-4           | `lifecycleStatus = won` is entered only when the four predicates above are satisfied. The interface names the unmet condition.                                                                                                                                                                                                                                                 |
| DL-4b          | `deals:confirm-payment` is a separate action from `deals:record-win`. Confirming money received and recording the commercial outcome are different assertions.                                                                                                                                                                                                                 |
| DL-4c          | **Confirming the advance creates a receipt in** **`payments`** **(§13.3 RCPT-4) and posts to the ledger.** The two are one event recorded once, not a deal flag and a separate finance entry that can drift apart. A deal cannot reach `won` unless the receipt exists.                                                                                                        |
| DL-5           | **Every win reports to the Sales Department Head** regardless of who closed it, appearing in their wins-to-record queue, where the official record is confirmed and the brief drafted.                                                                                                                                                                                         |
| DL-6           | Custom contract terms require an approver whose position permits them. Contract issuance and initial payment are gated behind sign-off where the approval path requires it.                                                                                                                                                                                                    |
| DL-7           | A value or discount change after approval re-triggers the threshold check and, if already handed off, flags the linked brief and project budget for review rather than silently updating them.                                                                                                                                                                                 |
| DL-8           | `lifecycleStatus = lost` requires a structured reason. Cancellation and refund set `lifecycleStatus` and `paymentStatus`; they never delete a deal and never rewind `dealStage`.                                                                                                                                                                                               |
| DL-9           | Sourcing credit and closing credit are recorded separately (DL-12b) and drive incentive reporting and performance aggregates independently.                                                                                                                                                                                                                                    |
| DL-10          | **Multi-currency**: a deal carries its own currency; reporting converts at the rate effective on the closing date, stored on the deal so historical reports do not shift.                                                                                                                                                                                                      |
| DL-11          | **Forecasting**: weighted pipeline value by stage probability, with probabilities configurable per stage, visible to the Team Lead and above at their scope.                                                                                                                                                                                                                   |
| DL-12          | **Cross-team deals.** Because handover is open across teams (§10.4 HV-1), a deal may be originated by one team's agent and closed by another team's supervisor. Such a deal carries two attributions and both are permanent: `originatingAgent` (who sourced and worked the lead) and `closedBy` (who negotiated and closed it).                                               |
| DL-12a         | **Visibility is the union of both chains.** A principal sees the deal if their scope reaches `originatingAgent` **or** reaches `closedBy`. In the §3.5.1 example, a deal sourced by Ram and closed by Anand is visible to Manish and Team Lead A through Ram, and to Anand and Team Lead B through Anand. Both chains did work on it; both see it.                             |
| DL-12b         | **Credit is split, not shared.** Sourcing credit goes to `originatingAgent`; closing credit goes to `closedBy`. They are two separate metrics on two separate leaderboards, never one number divided in half. An agent's conversion rate counts deals they sourced; a supervisor's close rate counts deals they closed.                                                        |
| DL-12c         | The lead remains owned by the originating agent throughout, and the account is owned by them after closure (§12.2). Closing a deal does not transfer the relationship.                                                                                                                                                                                                         |
| DL-12d         | A cross-team deal appears in the Project Manager's wins queue exactly once, not once per team.                                                                                                                                                                                                                                                                                 |
| DL-12e         | Cross-team handover volume is reported, because a persistent pattern — one team's agents routinely closing through another team's supervisors — is either a coverage problem or a staffing signal, and either way somebody should see it.                                                                                                                                      |

**Acceptance**

- A deal above the closer's limit cannot reach `lifecycleStatus = won` without a recorded approval decision.
- A deal cannot reach `won` without a confirmed advance payment, and confirming payment is a separately authorized act from recording the win.
- Where the agent did not close it, their response omits the `commercials` object entirely while still reporting stage, lifecycle status and sourcing credit.
- With BD-9 disabled, no monetary field of any kind appears in that response.
- With BD-9 enabled, exactly `creditedValue` appears and nothing else from `commercials`.
- Every closed deal appears in the Project Manager's wins queue exactly once, including cross-team deals.
- A deal sourced in Team A and closed in Team B is visible to both Team Leads and to neither team's peers.
- A historical report re-run next year returns the same converted values.

### 10.6 `approvals`

**Purpose.** Make escalation automatic, and make sure an absent approver does not stop the business.

**Screens.** My approval queue · Approval detail · Threshold configuration *(in* *`system-administration`**)* · Delegation settings

**Requirements**

| # Requirement  |                                                                                                                                                                                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AP-1           | The threshold check runs on record and on every subsequent change. It is not a manual escalate button.                                                                                                                                                                               |
| AP-2           | A request exceeding the actor's limit enters `Pending Approval` and routes up the reporting chain. It cannot progress until decided.                                                                                                                                                 |
| AP-3           | An approver may approve, reject with a reason, or return for revision. Each action records actor, timestamp and note.                                                                                                                                                                |
| AP-4           | Approvals escalate on a timer. Unanswered past a configured window, the request notifies the next level up and appears on the Super Admin dashboard.                                                                                                                                 |
| AP-5           | **Absolute constraint A1 — segregation of duties.** No principal may approve a request they raised, at any level, including Super Admin. Where the only eligible approver is the requester, the request escalates to the next level automatically rather than stalling.              |
| AP-6           | **Out-of-office delegation.** A user may nominate a delegate for approvals during a defined period. Delegated decisions record both the delegate and the original approver. A delegate must satisfy **all four** of the following — approval authority is not reducible to a number: |
| AP-6a          | 1. **Limit** — the delegate's approval limits are equal to or greater than the delegator's, for the specific dimension being approved (value, discount, custom terms).                                                                                                               |
| AP-6b          | 2. **Capability** — the delegate holds the underlying action. A Development Department Head with a high notional limit does not hold `deals:approve` and therefore cannot receive a sales delegation.                                                                                |
| AP-6c          | 3. **Scope** — the delegate's authorization scope covers the records in question. A Team Lead cannot delegate to a peer whose team scope excludes their pipeline.                                                                                                                    |
| AP-6d          | 4. **Organizational boundary** — the delegate sits in the same department, or is an ancestor of the delegator in the reporting chain. Cross-department delegation of commercial authority is refused.                                                                                |
| AP-6e          | The delegation form filters the candidate list to people who satisfy all four, and states the failing condition for anyone excluded.                                                                                                                                                 |
| AP-7           | Delegation activates automatically when an approver has approved leave covering the period, so the business does not stall because someone forgot to set it.                                                                                                                         |
| AP-8           | A delegate cannot delegate onward. One hop only.                                                                                                                                                                                                                                     |
| AP-9           | Approvals apply uniformly to deals, discounts, custom terms, contracts, payments, billable change requests, and any future approval-bearing workflow. Adding a workflow does not require a new approval mechanism.                                                                   |
| AP-10          | Every decision is audited, including who was delegating for whom.                                                                                                                                                                                                                    |

**Acceptance**

- A Team Lead closing a deal above their own limit routes to the Project Manager like anyone else.
- An approver on approved leave has their queue automatically routed to their delegate.
- A delegate attempting to delegate onward is refused.

---

## 11. Module Specifications — Delivery

### 11.1 `handoff` — Project Brief and Feasibility

**Purpose.** The single gated bridge between Sales and Delivery.

**Screens.** Brief queue · Compile brief · Brief detail and review thread · Feasibility queue

**Requirements**

| # Requirement  |                                                                                                                                                                                                                                                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HF-1           | A brief can only be drafted from a deal at `lifecycleStatus = won`, which by construction means approval, contract and advance payment are all satisfied (§10.5). The handoff module does not re-check them; it checks one state.                                                                                                                       |
| HF-1b          | **The brief passes three parties in sequence.** The Sales Department Head **drafts** it from the won deal. A Project Manager is assigned and **confirms** it, or queries it back to Sales with a reason. Only a confirmed brief reaches the Development Department Head for **feasibility**.                                                            |
| HF-1c          | Sales knows what was sold; the Project Manager knows what can be delivered and will be held to it. The confirm step costs a day and is the last cheap moment to catch a mismatch between the two.                                                                                                                                                       |
| HF-1d          | **Confirming makes the Project Manager the owner** of the project that results. A PM never inherits a project they did not confirm, except by explicit Super Admin reassignment.                                                                                                                                                                        |
| HF-1e          | A queried-back brief returns to the Sales Department Head, who amends it or renegotiates with the client. A flagged-back brief — rejected at feasibility — returns to the **Project Manager**, who renegotiates scope, budget or timeline and resubmits a linked revision. Different rejections, different owners, because they are different problems. |
| HF-2           | The brief carries requirements, budget, timeline with milestones, client contact, services sold, deliverables, agreed custom terms, files, and any informal feasibility opinion already given during negotiation.                                                                                                                                       |
| HF-3           | The Development Department Head returns **Accepted** (project created, the confirming PM becomes its owner, team allocation follows) or **Flagged Back** with a structured reason: needs more time, needs more budget, scope unclear, capacity unavailable — plus free text.                                                                            |
| HF-4           | A revision is always **linked to the original**. Every version is retained, so the negotiation history between Sales, Delivery and the client is visible on one record rather than reconstructed from memory.                                                                                                                                           |
| HF-5           | **A project is created only from an accepted brief.**                                                                                                                                                                                                                                                                                                   |
| HF-6           | The brief is the **permission boundary**: it carries requirements, budget, timeline and contact. It does not carry the deal, the discount, the pipeline or commissions.                                                                                                                                                                                 |
| HF-7           | Time in each state is measured. Sales-to-Delivery handoff time is a headline metric.                                                                                                                                                                                                                                                                    |
| HF-8           | A brief sitting unactioned past the configured SLA escalates to Super Admin — at either gate. A brief awaiting PM confirmation and a brief awaiting feasibility are both stalls, and both are measured.                                                                                                                                                 |

**Acceptance**

- A project cannot be created except from a brief that was drafted by Sales, confirmed by a Project Manager, and accepted at feasibility.
- The confirming Project Manager owns the resulting project.
- The Development Department Head's brief view contains no deal, discount or pipeline field, verified by direct API call.
- Handoff time is reportable from deal `won` to brief accepted.

### 11.2 `projects`

**Purpose.** The unit of delivery.

**Screens.** Project list and board · Project detail (Overview · Tasks · Team Chat · Client Chat · SEO · Files · Reports · Activity) · Internal project creation

**Requirements**

| # Requirement  |                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PJ-1           | A project has a named **Project Manager**, who owns the client relationship, the scope and the schedule, and a **Delivery Owner** (the Development Department Head), who owns capacity and standards. Accountability is explicit, not implied by team membership.                                                                                                                                                                       |
| PJ-1b          | The Project Manager directs the work on their own project through the dotted line (§3.7.1): assigning tasks, setting deadlines, re-prioritising. The Delivery Owner holds the capacity veto (PA-4) and the sub-team managers hold review (PA-6).                                                                                                                                                                                        |
| PJ-2           | One client may have many projects. Additional stakeholder accounts may be attached for portal access.                                                                                                                                                                                                                                                                                                                                   |
| PJ-3           | **Health is derived**, not entered: on-track; at-risk when a milestone is overdue or client communication has lapsed past threshold; overdue when the end date has passed and status is not complete.                                                                                                                                                                                                                                   |
| PJ-4           | **Progress is derived** from completed milestones and completed linked tasks. It is never a typed percentage.                                                                                                                                                                                                                                                                                                                           |
| PJ-5           | Project assignment is **not** organizational team membership. A developer belongs to one team and may be assigned to many projects.                                                                                                                                                                                                                                                                                                     |
| PJ-5b          | A Project Manager sees and directs **their own projects only**. Another PM's project is invisible to them — peers with no chain between them, exactly like two Sales Team Leads.                                                                                                                                                                                                                                                        |
| PJ-6           | **Team Chat and Client Chat are separate threads** with separate storage and separate authorization. A message cannot move between them. The most damaging possible defect in this product is an internal remark appearing in the client thread; separation by construction is the only acceptable design.                                                                                                                              |
| PJ-7           | Client Chat messages are attributed to the individual sender, not to the company. The client should know who they are talking to.                                                                                                                                                                                                                                                                                                       |
| PJ-8           | Base delivery employees have no Client Chat access. Client communication is the Project Manager's responsibility, enforced server-side.                                                                                                                                                                                                                                                                                                 |
| PJ-9           | Protected constraint P5: base delivery employees see brief content, specifications and deliverable requirements — never client contact details, payment details or contract terms. Enforced by projection so a direct API call returns the same reduced object.                                                                                                                                                                         |
| PJ-10          | A project cannot be deleted, only archived with a reason.                                                                                                                                                                                                                                                                                                                                                                               |
| PJ-11          | Changing the Project Manager notifies the outgoing manager, the incoming manager and the client contact.                                                                                                                                                                                                                                                                                                                                |
| PJ-12          | Activity is append-only and not editable by any principal.                                                                                                                                                                                                                                                                                                                                                                              |
| PJ-13          | **Internal projects** — work with no client — may be created directly, recording who authorized them. They never appear in a client portal.                                                                                                                                                                                                                                                                                             |
| PJ-14          | **Project profitability**: revenue recognised against cost incurred. Cost is derived from task time entries valued at a configurable role rate, plus any vendor bills coded to the project (§13.5). Revenue comes from the ledger, not the deal value, so a project that was sold for one figure and delivered against another reports the truth. Visible to the Project Manager, the Development Department Head and Super Admin only. |

**Acceptance**

- A client token requesting the team-chat endpoint receives 403.
- A developer not assigned to a project cannot open it by URL.
- A base employee's project response contains no client contact fields.

### 11.3 `tasks`

**Purpose.** The unit of work, with one lifecycle used everywhere in the product.

**Lifecycle**

```
   To Do ──► In Progress ──► Review ──► Done
                  ▲             │
                  └─ Revision ──┘
                     Needed
             (manager rejection, notes required)

```

**Screens.** My tasks · Tasks I assigned · Team board · Review queue · Department board · Task detail

**Requirements**

| # Requirement  |                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TK-1           | There is exactly one task lifecycle in the product. No module defines a second.                                                                                                                                                                                                                                                                                                                                                         |
| TK-2           | Only the assignee moves a task To Do → In Progress → Review.                                                                                                                                                                                                                                                                                                                                                                            |
| TK-3           | Only the assignee's sub-team manager, the Development Department Head or Super Admin moves Review → Done or → Revision Needed. **Revision Needed requires notes.** A Project Manager cannot, even on their own project (PA-6) — they set the work, not the standard it is judged against.                                                                                                                                               |
| TK-4           | Absolute constraint A1: an assignee cannot sign off their own submission unless they also assigned it to themselves.                                                                                                                                                                                                                                                                                                                    |
| TK-5           | Every transition appends to history with actor, timestamp and note. Revision count per task is a reported metric.                                                                                                                                                                                                                                                                                                                       |
| TK-6           | **Dependencies** sequence related work. A task whose dependency is incomplete can be assigned but cannot enter In Progress, and states why.                                                                                                                                                                                                                                                                                             |
| TK-7           | Only the Development Department Head can create a dependency spanning two sub-teams.                                                                                                                                                                                                                                                                                                                                                    |
| TK-8           | Assignment respects scope. A sub-team manager assigns within their own sub-team. The Development Department Head assigns across all three. **A Project Manager assigns on their own projects only** (§3.7.1 PA-1), across whichever sub-teams that project touches.                                                                                                                                                                     |
| TK-8b          | A PM-originated assignment is tagged as such (PA-7), and the Development Department Head may reject or reassign it on capacity grounds with a recorded reason (PA-4). The rejection is visible to the PM and escalates to Super Admin if disputed.                                                                                                                                                                                      |
| TK-9           | Base employees cannot see teammates' tasks, even within their own sub-team, unless the manager has enabled shared visibility for that team. This is a team setting, not a protected constraint — a manager may turn it on.                                                                                                                                                                                                              |
| TK-9b          | Protected constraint P6 governs the harder boundary: no sub-team manager reaches another sub-team's tasks, and no team setting can enable it. Only the Development Department Head sees across all three.                                                                                                                                                                                                                               |
| TK-10          | **Time tracking**: an assignee may log time against a task, with an optional estimate at assignment. Time feeds project profitability, capacity planning and **time-and-materials invoicing** (§13.2 IN-3). Logging is required only where the project is configured to require it — and is **mandatory** on any project billed on time and materials, since an unlogged hour on such a project is revenue that will never be invoiced. |
| TK-10b         | Time entries on a billable project require **approval** by the sub-team manager before they can be invoiced. Unapproved time is excluded from invoicing and listed, so nobody wonders where it went.                                                                                                                                                                                                                                    |
| TK-11          | Tasks are never deleted, only cancelled with a reason.                                                                                                                                                                                                                                                                                                                                                                                  |
| TK-12          | Overdue tasks notify assignee and assigner daily until resolved.                                                                                                                                                                                                                                                                                                                                                                        |

**Acceptance**

- A sub-team manager's board contains exactly their sub-team and returns 403 for another sub-team's tasks.
- An assignee cannot mark their own task Done.
- A task blocked by an incomplete dependency cannot start and says why.

### 11.4 `resource-planning`

**Purpose.** Let the Development Department Head answer "can we take this on?" before agreeing to a brief, and "who is free?" before allocating.

**Screens.** Capacity board · Allocation planner · Workload by person · Availability calendar

**Requirements**

| # Requirement  |                                                                                                                                                                                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RP-1           | Capacity is derived from headcount, shift hours, approved leave, holidays and current assigned task load. It is not typed in.                                                                                                                             |
| RP-2           | The capacity board shows each sub-team's committed hours against available hours for the coming weeks.                                                                                                                                                    |
| RP-3           | Allocation to a brief shows the projected effect on capacity **before** confirming, so a feasibility decision is informed rather than intuitive.                                                                                                          |
| RP-4           | Workload per person surfaces over-allocation, with specialization shown so work can be matched to skill.                                                                                                                                                  |
| RP-5           | Approved leave and holidays reduce availability automatically.                                                                                                                                                                                            |
| RP-6           | Only the Development Department Head allocates across sub-teams. Sub-team managers allocate within their own. **Project Managers have read-only access to capacity** — enough to plan a realistic schedule, not enough to claim someone else's developer. |
| RP-7           | Where two Project Managers need the same person in the same week, the Development Department Head resolves it (PA-5). The capacity board shows competing demand explicitly rather than leaving it to whoever books first.                                 |

**Acceptance**

- Approving a two-week leave reduces that person's availability on the capacity board immediately.
- Allocating a brief shows the projected capacity effect before confirmation.

### 11.5 `delivery`

**Purpose.** The controlled path from "Delivery says it is finished" to "the client has signed off", including the loop when they have not.

**Screens.** Delivery queue · Delivery detail · Change request queue · Client sign-off *(in the portal)*

**Requirements**

| # Requirement  |                                                                                                                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DV-1           | **Only the Development Department Head marks a project Delivered.** A sub-team completing its portion does not deliver the project.                                                      |
| DV-2           | Delivered work goes to the Project Manager, who shares it with the client. Delivery never contacts the client directly.                                                                  |
| DV-3           | Client approves → the project is Closed and moves to post-closure.                                                                                                                       |
| DV-4           | Client requests changes → the Project Manager logs the feedback and **classifies it free fix or billable, with a reason**. Classification is a commercial decision and belongs to Sales. |
| DV-5           | A billable change above threshold routes through the approval chain and may generate a linked deal.                                                                                      |
| DV-5b          | An approved billable change becomes an **invoice line** linked to the change request (§13.2 IN-4), so the client can see exactly what they are paying for.                               |
| DV-6           | A classified change routes to the Development Department Head, who assigns it to **the relevant sub-team only**. It re-enters the task lifecycle. It does not reopen the whole project.  |
| DV-7           | Revision cycles per project are counted and reported; revision rate is a delivery metric.                                                                                                |
| DV-8           | A change request is never deleted. Rejected requests keep the reason.                                                                                                                    |
| DV-9           | Sign-off is recorded against the client account that performed it, with a timestamp. It is the contractual record that the work was accepted.                                            |
| DV-9b          | **Sign-off triggers revenue recognition** on a fixed-fee engagement (§13.6 LG-8). Until the client accepts the work, cash received against it is a liability, not revenue.               |
| DV-10          | Absolute constraint A3: a recorded sign-off is immutable.                                                                                                                                |

**Acceptance**

- A sub-team manager cannot mark a project Delivered; the endpoint returns 403.
- A change request cannot be assigned until classified.
- A billable change above threshold cannot proceed without a recorded decision.

---

## 12. Module Specifications — Client

### 12.1 `clients`

**Purpose.** The customer record, the credentials that let them into their own portal, and the account relationship that outlives any single project.

**Screens.** Client list · Add client · Client detail (Overview · Projects · Access · Communication · Requests · Billing · Account)

**Requirements**

| # Requirement  |                                                                                                                                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CL-1           | A client is an authentication principal in its own namespace. Clients never hold a Position.                                                                                                                                    |
| CL-2           | **Credentials are issued, never read back.** The interface offers "set password" and "send reset link", not "show password".                                                                                                    |
| CL-3           | A client's portal visibility is exactly the set of projects they are attached to. There is no separate access list to keep in sync.                                                                                             |
| CL-4           | Absolute constraint A2: every client request is filtered by their account at the query level, not after fetch.                                                                                                                  |
| CL-5           | Deactivating a client revokes portal sessions within 60 seconds and preserves all history.                                                                                                                                      |
| CL-6           | **Client requests** raised from the portal route to the assigned Project Manager with a priority and an SLA clock. Breaching the SLA escalates to the Project Manager's manager and appears on the Super Admin dashboard.       |
| CL-6b          | The client's **billing tab** shows their invoices, what has been paid, what is outstanding and its age, their statement of account, and downloadable PDFs. Scoped by absolute constraint A2 like everything else in the portal. |
| CL-6c          | A client may **raise a dispute** against an invoice from the portal, which pauses dunning for that invoice (§13.4 RC-4) and creates a request routed to the Project Manager.                                                    |
| CL-7           | Every credential operation — issue, reset, revoke — is audited.                                                                                                                                                                 |
| CL-8           | The **account owner** is the originating sales agent after closure, and is a required field on any client with a closed deal.                                                                                                   |
| CL-9           | Client contact records support multiple contacts per account with roles, so a departing champion does not orphan the relationship.                                                                                              |

**Acceptance**

- A client portal login sees exactly the projects they are attached to.
- No endpoint returns a client password.
- Revoking access ends the client's session within 60 seconds.

### 12.2 `post-closure`

**Purpose.** A closed project is not the end of the relationship, and the system should know who owns it.

**Screens.** My accounts · Renewal pipeline · Account history

**Requirements**

| # Requirement  |                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PC-1           | **Account ownership persists with the originating agent** after closure. They handle final feedback, upsell and renewal. This is why P1 is field-level rather than record-level: the agent owns the relationship without seeing the contract terms.                                                                                                                                                      |
| PC-1a          | **Owning the account does not grant access to the deal.** P1 governs the Deal resource; the account policy governs the Account resource. They are evaluated independently, and a future requirement to widen account visibility cannot silently widen deal visibility as a side effect.                                                                                                                  |
| PC-1b          | What the account owner sees on their own account: client contacts, project list and status, communication history, renewal dates, and open requests. What they do not see, absent an explicit Super Admin grant: contract value, discount, payment schedule, margin, or any figure sourced from `Deal.commercials`.                                                                                      |
| PC-1c          | If the business concludes an account owner needs contract value to hold a credible renewal conversation (BD-10), the resolution is a **narrow, named, audited field grant on the account policy** — not an exception carved into P1. P1 stays intact; the account policy widens by exactly the fields agreed.                                                                                            |
| PC-2           | **Ownership transfer is an explicit workflow**, `accounts:manage-ownership`, not a field edit. It records the outgoing owner, the incoming owner, the actor, a reason, and an **effective date**. Both parties and the client's Project Manager are notified.                                                                                                                                            |
| PC-2b          | Transfer is permitted by a Supervisor within their pool, a Team Lead across pools in their team, or the Project Manager anywhere in the department.                                                                                                                                                                                                                                                      |
| PC-2c          | **Automatic transfer triggers.** Ownership does not silently persist with someone who cannot act on it. It is force-reassigned, with the reason recorded as systemic rather than discretionary, when the owner is set to `inactive`, `terminated` or `absconded`; when the owner moves to a team that does not cover the account's territory; or when the owner is suspended beyond a configured period. |
| PC-2d          | On a trigger, the account routes to the owner's Supervisor as **interim owner** and appears in a reassignment queue. An account is never ownerless.                                                                                                                                                                                                                                                      |
| PC-2e          | Historical attribution is **not** rewritten by a transfer. Deals credited to the previous owner stay credited to them. Ownership governs the future relationship, not the past record.                                                                                                                                                                                                                   |
| PC-2f          | An account with an open renewal or upsell deal cannot transfer without explicitly deciding whether that deal's credit transfers too. The decision is recorded.                                                                                                                                                                                                                                           |
| PC-3           | A renewal opportunity is generated automatically from a deal's contract end date and appears on the account owner's dashboard ahead of the date by a configured window.                                                                                                                                                                                                                                  |
| PC-3b          | A **retainer** engagement drives a recurring invoice schedule (§13.2 IN-2). Ending or renewing the retainer ends or extends the schedule; the two are never maintained separately.                                                                                                                                                                                                                       |
| PC-4           | An upsell or renewal that proceeds creates a **new deal** linked to the client and the prior project, running the normal approval chain. It never edits the closed deal.                                                                                                                                                                                                                                 |
| PC-5           | Revenue history accrues per account and is **derived from the ledger**, not from the pipeline. Where the pipeline and the accounts disagree about what a client is worth, the accounts are right (§13.6 LG-13).                                                                                                                                                                                          |
| PC-6           | Offboarding an agent requires reassigning their accounts (§9.2 ON-4).                                                                                                                                                                                                                                                                                                                                    |

**Acceptance**

- A closed project leaves the client with a named account owner.
- A renewal opportunity appears ahead of the contract end date with no manual creation.
- An upsell creates a new deal and does not modify the closed one.

### 12.3 `client-portal`

**Purpose.** A deliberately small external surface whose job is to reduce status-chasing email, not to expose the system.

**Screens.** Client dashboard · My projects · Project view · Sign-off · My requests · Billing · My profile

**Visible / not visible**

| Visible Not visible                              |                                  |
| ------------------------------------------------ | -------------------------------- |
| Project name, type, description, status          | Team chat, internal notes        |
| Progress and milestone completion                | Internal task detail             |
| Start and end dates                              | Budget and profitability         |
| Assigned Project Manager's work name and contact | Individual employee assignments  |
| The client communication thread                  | The deal record, discount, terms |
| Shared files and published reports               | Any other client's data          |
| SEO reporting where the project includes it      | Any employee's personal data     |

**Requirements**

| # Requirement  |                                                                                                                         |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- |
| CP-1           | Absolute constraint A2 governs every request: filtered by the client's account before the query executes.               |
| CP-2           | A request for another client's resource returns **404, not 403** — the existence of the resource is itself information. |
| CP-3           | Files are delivered through short-lived signed URLs.                                                                    |
| CP-4           | Removing a client from a project removes portal access within 60 seconds.                                               |
| CP-5           | Sign-off is a first-class action producing an immutable record (§11.5 DV-9).                                            |
| CP-6           | The portal is mobile-usable. Clients sign off from phones.                                                              |

**Acceptance**

- A client calling any endpoint for another client's project receives 404.
- A client cannot reach a team chat thread by any route.

---

## 13. Module Specifications — Finance

Finance ships **inactive** (D-6). Every requirement below is implemented at launch; the department and its two positions are simply unstaffed, with Super Admin holding the capability and granting individual actions as needed.

**Statutory context.** These requirements assume Indian GST law and an April–March financial year. Where a rule exists because the law requires it rather than because the business chose it, that is stated — those rules are not negotiable and must not be softened during implementation.

### 13.1 `billing-terms` — What Each Client Pays

**Purpose.** Hold the commercial terms behind every invoice, so that raising an invoice is a clerical act performed against agreed terms rather than a pricing decision made at the keyboard.

**Screens.** Client billing terms · Rate card library · Credit exposure · Write-off authority

**Requirements**

| # Requirement  |                                                                                                                                                                                                                                                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BT-1           | Per client: currency, rate card, negotiated discount, payment terms (net days), credit limit, write-off ceiling, GST treatment, TDS applicability, PO requirement, and billing contact.                                                                                                                    |
| BT-2           | **Protected constraint P8: only Super Admin may write these.** The authority is not grantable, not delegable, and does not pass to a Finance Manager when Finance is staffed. Setting what a customer pays is the single most consequential commercial act in the product and it stays with one principal. |
| BT-3           | **Read** access is separately grantable and off by default. A Finance Manager doing collections may be granted read on credit limit and payment terms without ever seeing the rate card or the discount.                                                                                                   |
| BT-4           | A **rate card** is a named, versioned set of prices per service — hourly rates by role for time and materials, monthly amounts for retainers, fixed amounts for project types. Versioned by effective date so a historical invoice can always be explained.                                                |
| BT-5           | Changing a rate card does **not** alter invoices already issued and does not alter open recurring schedules without explicit confirmation, which lists every affected client.                                                                                                                              |
| BT-6           | **Credit limit** is advisory by default: exceeding it raises a flag on the client and warns at invoice creation. It can be set to blocking per client, which prevents new invoices until the balance falls below the limit.                                                                                |
| BT-7           | A **write-off ceiling** caps how much bad debt a holder of `receivables:write-off` may write off in one action. Above it, Super Admin decides.                                                                                                                                                             |
| BT-8           | Every change to any billing term is audited with before and after values and a mandatory reason.                                                                                                                                                                                                           |
| BT-9           | Billing terms are inherited by a client's projects and by any deal raised against them, so a Deal's commercials default from the client's card rather than being typed fresh each time.                                                                                                                    |

**Acceptance**

- No principal other than Super Admin can write a billing term through any endpoint, including a Finance Manager and including a delegate.
- A user granted `invoicing:create` can raise a correct invoice for a client without being able to read that client's rate card or credit limit.
- An issued invoice remains explainable after a rate card change, because it carries the version that produced it.

### 13.2 `invoicing`

**Purpose.** Produce statutorily correct invoices from agreed terms, for the three ways this business charges: one-off project fees, monthly retainers, and time and materials.

**Screens.** Invoice list · Create invoice · Invoice detail · Recurring schedules · Credit and debit notes · e-Invoicing queue · Numbering series

**Invoice lifecycle**

```
   draft ──► issued ──► sent ──► part-paid ──► paid
     │          │                    │
     │          └──► cancelled       └──► overdue ──► written-off
     │               (pre-issue                       (via credit note)
     │                only)
     └──► deleted (drafts only)

```

**Requirements — generation**

| # Requirement  |                                                                                                                                                                                                                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IN-1           | **One-off project fee.** An invoice is raised against a project, defaulting to the deal value less any advance already received. Advances appear as a deduction on the invoice, not as a separate credit.                                                                                      |
| IN-2           | **Monthly retainer.** A recurring schedule generates an invoice automatically on a configured day each month, for the agreed amount, until the schedule ends or is cancelled. Generation happens in draft by default so a human confirms before issue; a per-client setting allows auto-issue. |
| IN-3           | **Time and materials.** An invoice is generated from **approved** task time entries (TK-10) in a period, valued at the role rates on the client's rate card. Unapproved time is excluded and is listed so nobody wonders where it went.                                                        |
| IN-4           | A **billable change request** (DV-4) becomes an invoice line, linked to the change so the client can see what they are paying for.                                                                                                                                                             |
| IN-5           | Mixed invoices are supported: a single invoice may carry retainer, T&M and change-request lines.                                                                                                                                                                                               |
| IN-6           | Every line carries a description, quantity, unit rate, amount, HSN/SAC code and tax treatment.                                                                                                                                                                                                 |
| IN-7           | An invoice cannot be raised for a client with no billing terms configured. The error names the missing configuration and links to it.                                                                                                                                                          |

**Requirements — statutory**

| # Requirement  |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IN-8           | **Numbering is gapless and sequential per financial year, per series.** This is a **product invariant**, designed to satisfy the applicable GST serial-number requirements. Statutory interpretation, exemptions and exceptional cases are subject to tax and compliance review (BD-27) — the system's job is to make the invariant hold, not to adjudicate the law. Numbers are allocated at issue, never at draft, so an abandoned draft consumes none. A cancelled issued invoice keeps its number and is cancelled by credit note, never deleted. |
| IN-9           | Separate series are supported for tax invoices, export invoices, credit notes and debit notes, each independently gapless.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| IN-10          | **GST is computed by place of supply.** Same state as the supplier: CGST + SGST. Different state: IGST. Export: zero-rated under LUT, or with IGST paid where no LUT exists. Place of supply is derived from the client's registered address and is overridable per invoice with a recorded reason.                                                                                                                                                                                                                                                   |
| IN-11          | GST rates are configuration, versioned by effective date. A rate change applies to invoices issued from its effective date and never retro-alters an issued invoice.                                                                                                                                                                                                                                                                                                                                                                                  |
| IN-12          | Client GSTIN is validated for format and, where the integration is enabled, verified against the GST portal. An unregistered client is billed accordingly and is flagged as such on the invoice.                                                                                                                                                                                                                                                                                                                                                      |
| IN-13          | **e-Invoicing (IRN).** Where the organization exceeds the notified turnover threshold, an issued invoice is submitted to the Invoice Registration Portal, and the returned IRN and signed QR code are stored and printed on the invoice. Submission failures queue with the error and are retryable; an invoice with a failed IRN is flagged and cannot be sent to the client until resolved.                                                                                                                                                         |
| IN-14          | **TDS.** Where the client deducts tax at source, the invoice records the expected TDS rate and amount. The receivable is the gross; the expected receipt is net. This is what stops a ₹90 receipt against a ₹100 invoice being treated as a short payment (§13.4 RC-5).                                                                                                                                                                                                                                                                               |
| IN-15          | Invoices are issued as PDF with the statutorily required fields, and are archived immutably.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

**Requirements — lifecycle**

| # Requirement  |                                                                                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| IN-16          | **A3: an issued invoice is immutable.** Correction is by credit note (full or partial) plus a fresh invoice where appropriate. There is no edit path and no delete path after issue. |
| IN-17          | Drafts are freely editable and deletable, and consume no number.                                                                                                                     |
| IN-18          | Issuing an invoice posts a journal entry: debit Accounts Receivable, credit Revenue, credit GST Payable (§13.6).                                                                     |
| IN-19          | An invoice becomes `overdue` the day after its due date, computed from the client's payment terms.                                                                                   |
| IN-20          | Absolute constraint A1 applies where invoice approval is configured: the person who raised an invoice does not approve it.                                                           |
| IN-21          | Sending an invoice to a client makes it visible in the client portal and records the send with channel and timestamp.                                                                |

**Acceptance**

- Issued invoice numbers are gapless within each series and financial year under concurrent creation.
- An intra-state invoice carries CGST and SGST; an inter-state invoice carries IGST; an export invoice under LUT carries neither.
- An issued invoice cannot be edited or deleted by any principal including Super Admin.
- A retainer schedule generates the correct invoice on the correct day without manual intervention.
- A T&M invoice excludes unapproved time and lists what it excluded.

### 13.3 `payments`

**Purpose.** Record money received, allocate it to what it pays for, and keep the bank reconcilable.

**Screens.** Receipts · Record receipt · Allocation · Advances · Refunds · Bank reconciliation

**Requirements**

| # Requirement  |                                                                                                                                                                                                                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RCPT-1         | A receipt records amount, date, method, reference, bank account and payer. It is recorded against a **client**, then **allocated** to one or more invoices.                                                                                                                                  |
| RCPT-2         | Allocation is explicit and may be partial, may span several invoices, and may leave a remainder **on account**. An unallocated remainder is visible, never silently absorbed.                                                                                                                |
| RCPT-3         | **Advances** received before an invoice exists are recorded on account and post to a liability, not to revenue (§13.6 LG-4). They allocate to an invoice when one is raised.                                                                                                                 |
| RCPT-4         | Confirming a deal's advance payment (`deals:confirm-payment`) **creates a receipt** in this module. The two are the same event and are recorded once. A deal cannot reach `won` without the receipt existing.                                                                                |
| RCPT-5         | **A3: a recorded receipt is immutable.** Correction is by reversal with a reason, which is itself a record.                                                                                                                                                                                  |
| RCPT-6         | A refund is a separate document referencing the original receipt, requiring approval, and posting its own journal entry.                                                                                                                                                                     |
| RCPT-7         | **Bank reconciliation.** Imported or entered bank lines are matched to receipts and payments. Unmatched items on either side are listed and age. Reconciliation is per bank account, per period, and a period cannot close with unreconciled items unless explicitly accepted with a reason. |
| RCPT-8         | Absolute constraint A1: whoever records a receipt does not reconcile it, and whoever raises a refund does not approve it.                                                                                                                                                                    |
| RCPT-9         | Recording a receipt posts: debit Bank, credit Accounts Receivable — or credit Advances from Customers where no invoice exists yet.                                                                                                                                                           |

**Acceptance**

- A ₹100,000 receipt allocated across three invoices leaves the correct balance on each and zero unallocated.
- An advance received before invoicing appears as a liability, not revenue, and clears when the invoice is raised.
- Confirming a deal advance produces exactly one receipt, and the deal cannot be won without it.

### 13.4 `receivables`

**Purpose.** Know what is owed, by whom, for how long — and chase it without anybody maintaining a spreadsheet.

**Screens.** Aging · Client statement · Dunning schedule · Collections queue · TDS reconciliation · Write-offs

**Requirements**

| # Requirement  |                                                                                                                                                                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RC-1           | **Aging** buckets receivables at current, 1–30, 31–60, 61–90 and 90+ days past due, per client and in total, with drill-through to the invoices behind every figure.                                                                                                |
| RC-2           | A **statement of account** per client shows opening balance, invoices, receipts, credit notes and closing balance for a period, and is sendable to the client.                                                                                                      |
| RC-3           | **Dunning** is a configurable reminder schedule — for example at 3 days before due, on the due date, and at 7, 15 and 30 days past due — sent to the client's billing contact by email and optionally WhatsApp, with the invoice attached.                          |
| RC-4           | Dunning **pauses automatically** when the client raises a dispute against an invoice, and resumes when the dispute is resolved. Chasing a client who has already told you there is a problem is how a payment delay becomes a relationship problem.                 |
| RC-5           | **TDS reconciliation.** A receipt short by exactly the expected TDS amount is recognised as TDS-deducted, not short-paid, and the difference is posted to TDS Receivable rather than left as an open balance. Unmatched short payments remain open and are flagged. |
| RC-6           | TDS receivable is reconciled against Form 26AS data when available, and the variance is reported.                                                                                                                                                                   |
| RC-7           | The **collections queue** lists overdue invoices by value and age, with the account owner, the Project Manager, contact history and next action.                                                                                                                    |
| RC-8           | A **write-off** requires a reason, is capped by the client's write-off ceiling (BT-7), and above that ceiling requires Super Admin. It is executed as a credit note so the receivable clears through a document rather than by adjustment.                          |
| RC-9           | Absolute constraint A1: whoever proposes a write-off does not approve it.                                                                                                                                                                                           |
| RC-10          | Exceeding a credit limit raises a flag visible to the Project Manager and Super Admin, and blocks new invoices where the limit is set to blocking (BT-6).                                                                                                           |

**Acceptance**

- Aging totals reconcile exactly to the Accounts Receivable control account.
- A ₹90,000 receipt against a ₹100,000 invoice with 10% TDS closes the invoice and posts ₹10,000 to TDS Receivable, leaving no open balance.
- Raising a dispute stops dunning within one cycle.
- A write-off above the ceiling cannot proceed without Super Admin.

### 13.5 `payables`

**Purpose.** Vendor bills and employee reimbursements, so the profit and loss account is real rather than revenue-only.

**Screens.** Vendor bills · Vendors · Payment runs · My reimbursements · Reimbursement approvals

**Requirements**

| # Requirement  |                                                                                                                                                                                                                                                                 |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VB-1           | A vendor bill records vendor, bill number, date, due date, lines with expense account and tax, and attachments.                                                                                                                                                 |
| VB-2           | **Input GST** on eligible bills is recorded for input tax credit and reported against GSTR-2B. Ineligible or blocked credit is marked as such.                                                                                                                  |
| VB-3           | **TDS payable.** Where the organization must deduct tax at source on a vendor payment, the bill records the section, rate and amount; the payment is net and the deduction posts to TDS Payable.                                                                |
| VB-4           | **Employee reimbursement** is a claim raised by any employee with receipts attached, approved by their manager, and paid through a payment run. This is the one finance surface every employee touches, which is why `payables` reads `own` for everyone in §6. |
| VB-5           | A payment run selects approved bills and claims by due date, produces a payment file or list, and posts on execution.                                                                                                                                           |
| VB-6           | Absolute constraint A1: whoever raises a bill or a claim does not approve it, and whoever approves does not execute the payment run. Three roles where the organization is large enough; two as a minimum.                                                      |
| VB-7           | Vendor bills post: debit Expense, credit Accounts Payable, debit Input GST where eligible.                                                                                                                                                                      |
| VB-8           | Reimbursement claims follow the same approval-and-audit machinery as every other request in the product. There is no separate expense-approval mechanism.                                                                                                       |

**Acceptance**

- An employee submits a claim, their manager approves it, and it appears in the next payment run without finance re-keying anything.
- Input GST on eligible bills reconciles to the GSTR-2B export.
- No principal can both raise and approve the same bill.

### 13.6 `accounting`

**Purpose.** The book of record. Double-entry, so that every figure in every report traces to a posting, and the whole thing balances.

**Screens.** Chart of accounts · Journal entries · General ledger · Trial balance · Period close · Profit and loss · Balance sheet · Cash flow · Tax filing exports

**Requirements — the ledger**

| # Requirement  |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LG-1           | **Double-entry.** Every posting has equal debits and credits. A journal that does not balance cannot be saved — not warned about, cannot be saved.                                                                                                                                                                                                                                                                                                                                                                                                  |
| LG-2           | A **chart of accounts** is configurable, seeded with a standard services-company structure: assets, liabilities, equity, income, expenses, with sub-accounts for Accounts Receivable, Accounts Payable, Bank, GST Payable, Input GST, TDS Receivable, TDS Payable, Advances from Customers, Deferred Revenue and Salary Payable.                                                                                                                                                                                                                    |
| LG-3           | **Every financial event posts automatically.** No routine transaction requires a manual journal. Manual journals exist for adjustments and require a reason.                                                                                                                                                                                                                                                                                                                                                                                        |
| LG-4           | Automatic postings: \<br>· Invoice issued → Dr AR, Cr Revenue, Cr GST Payable \<br>· Receipt → Dr Bank, Cr AR \<br>· Advance received → Dr Bank, **Cr Advances from Customers** (a liability, not revenue) \<br>· Revenue recognised → Dr Deferred Revenue, Cr Revenue \<br>· Credit note → Dr Revenue, Dr GST Payable, Cr AR \<br>· Vendor bill → Dr Expense, Dr Input GST, Cr AP \<br>· Vendor payment → Dr AP, Cr Bank, Cr TDS Payable \<br>· **Payroll published → Dr Salary Expense, Cr Salary Payable** \<br>· Write-off → Dr Bad Debt, Cr AR |
| LG-5           | **A3: a posted journal is immutable.** Correction is by reversing entry, and both remain visible.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| LG-6           | The **general ledger** is queryable per account, per period, with drill-through from any balance to the source document. A number a user cannot trace to a document is a number nobody will trust.                                                                                                                                                                                                                                                                                                                                                  |
| LG-7           | The **trial balance** must balance at all times. A background check runs after every posting batch and raises a critical alert on imbalance.                                                                                                                                                                                                                                                                                                                                                                                                        |

**Requirements — revenue recognition**

| # Requirement  |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LG-8           | Revenue is recognised when earned, not when invoiced or received. Three policies matching the three charging models: \<br>· **One-off project fee** — recognised on delivery sign-off (DV-9), or proportionally against agreed stages where the engagement is long \<br>· **Monthly retainer** — recognised evenly across the retainer month; an invoice raised in advance sits in Deferred Revenue until the month elapses \<br>· **Time and materials** — recognised as approved time is logged |
| LG-9           | An advance received against future work is a **liability** until the work is done. Treating cash as revenue on receipt is the single most common way a services company overstates a good month.                                                                                                                                                                                                                                                                                                  |

**Requirements — period and statements**

| # Requirement  |                                                                                                                                                                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| LG-10          | **Absolute constraint A4: nothing posts into a closed period.** Closing requires a checklist: bank reconciled, aging agrees to the AR control account, payables agree to the AP control account, GST reconciled, trial balance balanced.                                 |
| LG-11          | A closed period reopens only by Super Admin, with a reason. Both close and reopen are audited.                                                                                                                                                                           |
| LG-12          | **Profit and loss**, **balance sheet** and **cash flow** are produced for any period, comparative against the prior period and the same period last year.                                                                                                                |
| LG-13          | Financial statements are generated **from the ledger**, never from operational tables. If the P&L and the sales pipeline disagree about revenue, the P&L is right — it is the only figure that has been reconciled.                                                      |
| LG-14          | The financial year is **April to March**, configurable. Year-end close rolls income and expense balances to retained earnings and opens the new year.                                                                                                                    |
| LG-15          | **Tax filing exports**: GSTR-1 (outward supplies), GSTR-3B summary, and input credit reconciliation against GSTR-2B, in the formats a filing agent or portal accepts. TDS: Form 26Q data for deductions made, and TDS-receivable reconciliation for deductions suffered. |
| LG-16          | Absolute constraint A1: whoever posts a journal does not close the period.                                                                                                                                                                                               |

**Acceptance**

- The trial balance balances after every posting, verified by an automated check.
- Aging, the AR control account and the balance sheet agree to the rupee.
- A retainer invoiced in advance appears in Deferred Revenue and moves to Revenue as the month elapses.
- A closed period rejects every posting attempt, including from Super Admin.
- GSTR-1 export reconciles to the invoice register for the period.
- Payroll publication produces a balanced journal, and HR cannot read it.

---

## 14. Module Specifications — Cross-Cutting

### 14.1 `chat`

Internal messaging: direct, group and department channels. Presence from the same source as the live board. Attachments through signed URLs. Mentions, reactions, read receipts, pinning, drafts, editing within a time window, typing indicators.

**Requirements**

| # Requirement  |                                                                                                                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CH-1           | Chat is **not** scoped by hierarchy. Anyone may message anyone. A permission model that stops a developer asking HR a question creates shadow channels, and shadow channels are where the record goes to die. |
| CH-2           | Retention and export are Super Admin capabilities, disclosed to employees in-product.                                                                                                                         |
| CH-3           | Chat is never the system of record for a decision. Where a message would constitute an approval, a brief or a classification, the interface prompts the sender to record it in the owning module.             |

### 14.2 `project-communication`

Client-facing project threads and the cross-project communication tracker.

**Requirements**

| # Requirement  |                                                                                                                                                                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PM-1           | Every client-thread message updates the project's last-communication timestamp, which drives project health and the attention panel.                                                                                               |
| PM-2           | The tracker shows, per project: client, Project Manager, last message, direction, who sent it, age, **unanswered inbound count**, and total messages this month. Sorted by age descending, so the quietest projects surface first. |
| PM-3           | "Unanswered inbound" counts client messages with no team reply after them. This is the number that matters and the product should be loud about it.                                                                                |
| PM-4           | Silence thresholds are configurable per project type, defaulting to 14 days. Crossing one notifies the Project Manager and appears on the Super Admin dashboard.                                                                   |
| PM-5           | The tracker shows metadata only. Reading content requires opening the thread, which is separately authorized.                                                                                                                      |

### 14.3 `documents`

**Requirements**

| # Requirement  |                                                                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DC-1           | Documents inherit the authorization of the record they are attached to. A leave attachment obeys P4; a contract obeys P1.                                                             |
| DC-2           | Files are stored under random names; the database holds a relative path; URLs are signed on the way out with a short expiry. Nothing bakes a signature into stored data.              |
| DC-3           | One size limit applies everywhere. A file acceptable in chat is acceptable on a leave request.                                                                                        |
| DC-4           | **Versioning**: replacing a document creates a version, retaining the prior one with its uploader and timestamp.                                                                      |
| DC-5           | **Templates**: proposal, quotation, contract, project brief and task checklist templates are configurable and versioned, so a new agent's proposal looks like the company's proposal. |
| DC-6           | Documents shared with a client are explicitly marked as such. Sharing is an action, not a side effect of upload.                                                                      |

### 14.4 `reporting`

**Screens.** Role dashboards · Standard reports · Report builder · Scheduled reports · Export centre

**Standard reports**

| Domain Reports   |                                                                                                                                                    |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sales            | Pipeline by stage, conversion funnel, source and campaign attribution, agent and team leaderboards, deal velocity, forecast, territory performance |
| Delivery         | Task throughput, on-time delivery, revision rate, capacity utilization, project profitability, handoff time                                        |
| People           | Attendance, punctuality, break-breach trends, leave utilization, headcount and movement, payroll summary                                           |
| Client           | Revenue by account and period, renewal pipeline, request SLA, communication responsiveness                                                         |
| Cross-department | Lifecycle view — revenue, delivery timeline, team performance, client outcome                                                                      |

**Requirements**

| # Requirement  |                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| RE-1           | Every report obeys the caller's scope for the underlying data. A report is not a way around a permission.                |
| RE-2           | A number a user cannot drill into is not shown to them.                                                                  |
| RE-3           | Exports are separately authorized from viewing and every export is audited.                                              |
| RE-4           | Reports can be scheduled and delivered by email or notification on a cadence.                                            |
| RE-5           | The cross-department lifecycle report is Super Admin only. It is the one view spanning all three functions.              |
| RE-6           | Dashboard tiles carry an "as of" timestamp. A stale dashboard that looks live is worse than one that admits it is stale. |
| RE-7           | Any tile exceeding its time budget renders as unavailable rather than delaying the page.                                 |

### 14.5 `notifications`

**Requirements**

| # Requirement  |                                                                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| NT-1           | Every notification declares a type, a priority and an audience **resolved through the authorization engine**. A notification is never sent to someone who could not open the thing it points at. |
| NT-2           | Channels: in-app, push, email, WhatsApp. Per-user, per-type channel preferences.                                                                                                                 |
| NT-3           | The preference model distinguishes **informational** from **operational**. A user who turns off email for task assignments still receives critical operational notifications.                    |
| NT-4           | Delivery is recorded per channel with status and timestamp, so non-delivery is diagnosable.                                                                                                      |
| NT-5           | Every notification carries a deep link to the exact record.                                                                                                                                      |
| NT-6           | **Digests**: low-priority notifications can be batched into a daily or twice-daily digest per user preference.                                                                                   |
| NT-7           | **Quiet hours** are configurable per user. Operational notifications override them; informational ones queue.                                                                                    |
| NT-8           | Expired notifications are pruned on a schedule. The delivery log outlives the notification.                                                                                                      |

### 14.6 `workspace`

Personal tools available to every employee identically.

| Area Behaviour    |                                                                                                                                                                                                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Notepad**       | Private scratchpad with revision history. Protected constraint P3: owner and Super Admin only. A permanent, non-dismissible notice tells the employee that administration can view it. Super Admin reads are audited and the audit is visible to the employee. |
| **Todo**          | Personal task list, private to the user, visible to nobody including Super Admin. Distinct from assigned `tasks`.                                                                                                                                              |
| **Sheets**        | Embedded spreadsheet registry, shared **by position** so a new hire inherits automatically. Every open is logged.                                                                                                                                              |
| **Notices**       | Company announcements, scoped by department or position, with expiry. Unexpired notices appear once per session.                                                                                                                                               |
| **My profile**    | Own record. Editable: contact, emergency contact, address, avatar, notification preferences, password, sessions. Read-only: position, effective permissions, shift, salary.                                                                                    |
| **Global search** | One search across leads, clients, projects, tasks, employees and documents, **filtered by the caller's scope before ranking**. A search result the user cannot open is never returned.                                                                         |

**Requirements**

| # Requirement  |                                                                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| WS-1           | The effective-permissions view is deliberately visible to the employee, so "why can't I see X" is self-answerable.         |
| WS-2           | Global search results are scope-filtered at query time, not after ranking.                                                 |
| WS-3           | The notepad disclosure notice cannot be dismissed. An undisclosed capability here would be a trust problem, not a feature. |

---

## 15. Non-Functional Requirements

### 15.1 Performance

**All performance requirements are measured against the 12-month scale column in §16**, against a generated dataset of exactly that shape. The dataset specification is part of the test plan, not left to the tester's judgement.

**Reference dataset — 12 months**

| Entity Volume      |                                         |
| ------------------ | --------------------------------------- |
| Employees          | 2,000 (1,200 active concurrent-capable) |
| Concurrent users   | 1,200                                   |
| Leads              | 500,000                                 |
| Deals              | 50,000                                  |
| Clients            | 1,500                                   |
| Projects           | 2,000                                   |
| Tasks              | 250,000                                 |
| Attendance records | 600,000                                 |
| Documents          | 500,000                                 |
| Audit events       | 20,000,000                              |

| # Requirement Measured at  |                                                                                                                                                                                             |                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| NF-1                       | Any list view returns its first page within 1 s at p95                                                                                                                                      | 500k leads, 250k tasks            |
| NF-2                       | The live status board paints within 1.5 s and reflects a punch within 3 s                                                                                                                   | 2,000 employees, 1,200 concurrent |
| NF-3                       | Monthly attendance returns within 4 s                                                                                                                                                       | 2,000 employees, full month       |
| NF-4                       | Payroll generation completes within 3 minutes as a background job                                                                                                                           | 2,000 employees                   |
| NF-4b                      | Global search returns within 1.5 s at p95                                                                                                                                                   | Full reference dataset            |
| NF-4c                      | A scope-filtered report over 12 months returns within 8 s                                                                                                                                   | Full reference dataset            |
| NF-4d                      | Audit query filtered by actor and date range returns within 3 s                                                                                                                             | 20m entries                       |
| NF-5                       | Authorization evaluation adds under 20 ms at p95, achieved by caching the resolved policy set and subordinate set per request.                                                              |                                   |
| NF-6                       | Every scope-derived query is index-covered. A visibility filter that triggers a collection scan turns a security control into a performance problem, and performance problems get disabled. |                                   |

### 15.2 Reliability

| # Requirement  |                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| NF-7           | Attendance calculation is idempotent and versioned. Re-running produces identical results.                                            |
| NF-8           | Device punches are never dropped. Unmapped and failed punches are stored and replayable.                                              |
| NF-9           | Background jobs are idempotent and record a run outcome.                                                                              |
| NF-10          | Live connection loss degrades to polling with no data loss.                                                                           |
| NF-11          | A failed payroll run leaves no partial payslips.                                                                                      |
| NF-12          | Recovery objectives: RPO 15 minutes, RTO 4 hours. Restore is verified on a schedule, and an unverified restore is reported as a risk. |

### 15.3 Usability

| # Requirement  |                                                                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| NF-13          | Every permission-denied state explains what is missing and who can grant it. "Access denied" with no path forward generates a support request. |
| NF-14          | Every derived number exposes its provenance.                                                                                                   |
| NF-15          | All times display in the organization's configured timezone regardless of browser. Storage is UTC.                                             |
| NF-16          | Mobile-usable for the employee baseline: punch, break, status, tasks, leave, callbacks, chat, notifications — and the client portal.           |
| NF-17          | Bulk operations always offer a dry run before writing.                                                                                         |
| NF-18          | Accessibility: WCAG 2.1 AA for all employee-facing and client-facing screens.                                                                  |
| NF-19          | The interface degrades usefully on poor connectivity: punch and callback outcome capture queue locally and sync when the connection returns.   |

### 15.4 Maintainability

| # Requirement  |                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NF-20          | One implementation per capability. No parallel code paths for the same decision.                                                                                                                                                                                                                                                                                                                                           |
| NF-21          | **The action registry is the single source of authorization truth.** Client routes and server routes each reference it; neither is itself the source. One screen may exercise a dozen actions, and one URL family may carry four different capabilities by method, so authorization cannot be derived from a path. Drift between the registry and either route table fails the build.                                      |
| NF-22          | Every module has one living specification document.                                                                                                                                                                                                                                                                                                                                                                        |
| NF-22b         | The Permission Matrix (§6) is a **human-readable summary**, not an executable artefact. `TECH.md` carries the authoritative shorthand-to-Action-Registry mapping, and a CI check asserts every matrix cell has a corresponding registry entry. Where the two disagree, the registry is correct and the build fails.                                                                                                        |
| NF-23          | Every numbered rule in this document maps to at least one named automated test. A rule without a test is not implemented.                                                                                                                                                                                                                                                                                                  |
| NF-23b         | **Authorization and workflow eligibility are separate gates.** "May this principal act?" is the authorization engine; "is this record eligible for this transition?" is the module's state machine. Both must pass. A 403 means "not you"; a 422 means "not this record, not yet" — with the unmet predicate named. Conflating them turns every commercial policy change into a change to the security-critical component. |
| NF-24          | No authorization decision is made outside the authorization engine — and **protected constraints, segregation of duties and field policies are authorization decisions**. They live in the engine's constraint registry, not in handlers. A rule that is "business policy, not a permission" is exactly the rule that ends up duplicated in three controllers and enforced in two of them.                                 |

---

## 16. Security and Compliance

### 16.1 Controls

| # Requirement  |                                                                                                                                   |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| SE-1           | All authorization is server-side. Client-side filtering is presentation only.                                                     |
| SE-2           | Unknown actions **deny**. The system fails closed.                                                                                |
| SE-3           | Every endpoint operating on an object performs an object-level authorization check. Endpoint-level checks alone are insufficient. |
| SE-4           | Encryption in transit and at rest, including archived audit storage.                                                              |
| SE-5           | Rate limiting on authentication, export, bulk and search endpoints.                                                               |
| SE-6           | File access exclusively through short-lived signed URLs.                                                                          |
| SE-7           | Every sensitive read — payroll, notepad, employee documents, deal commercials — writes an audit entry.                            |
| SE-8           | Dependency and container scanning in the build pipeline; a critical finding blocks release.                                       |
| SE-9           | Annual penetration test with authorization boundary testing as a named scope item.                                                |
| SE-10          | Secrets are held in a managed secret store, never in configuration files or the database.                                         |

### 16.2 Data Protection

Applicable regimes depend on where the product operates and who it is sold to. The following are treated as baseline.

| # Requirement  |                                                                                                                                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DP-1           | **Data inventory**: every category of personal data held — employee, client contact, biometric identifier, location — is documented with its purpose, retention period and lawful basis.                                                   |
| DP-2           | **Biometric data**: only a device PIN mapping is stored. No fingerprint template, image or raw biometric leaves the device. This is stated explicitly because biometric data attracts the strictest handling requirements in most regimes. |
| DP-3           | **Location data** from geofenced login is retained for 90 days by default and is used only for the access decision and its audit.                                                                                                          |
| DP-4           | **Subject access**: an employee or client can request an export of the personal data held about them, produced in a machine-readable format.                                                                                               |
| DP-5           | **Erasure**: personal data is erasable on request except where statutory retention applies — payroll, attendance and audit. Erasure produces a record of what was retained and why.                                                        |
| DP-6           | **Retention**: audit 7 years; payroll 7 years; attendance 7 years; notifications 1 year; chat configurable; location 90 days; archived records encrypted with a separately managed key.                                                    |
| DP-7           | **Consent and notice**: employees are told in-product what is monitored — attendance, breaks, location where fenced, notepad visibility to Super Admin. Nothing is monitored silently.                                                     |
| DP-8           | **Breach response**: a documented procedure with a notification timeline, an owner, and audit evidence available to reconstruct the scope of any incident.                                                                                 |
| DP-9           | **Sub-processors**: every third-party integration receiving personal data is recorded with what it receives and why.                                                                                                                       |

### 16.3 Segregation of Duties

Treated as a first-class control rather than a per-module rule, so that adding a workflow does not require inventing a new prohibition.

| # Rule  |                                                                                                                                                                                                                                                        |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SD-1    | The initiator of any approval-bearing item may not be its approver. Every approval-bearing action declares its initiator field; an action that declares none fails the build, and a declared field missing from the record denies rather than passing. |
| SD-2    | The creator of a financial record may not be its sole approver.                                                                                                                                                                                        |
| SD-3    | Where the only eligible approver is the requester, the item escalates automatically rather than stalling.                                                                                                                                              |
| SD-4    | These rules bind every principal including Super Admin, and are evaluated **before** any privilege bypass.                                                                                                                                             |
| SD-5    | Every enforcement of a segregation rule is logged, so a blocked self-approval is visible rather than silent.                                                                                                                                           |

---

## 17. Scale Targets

Design targets, not current volumes. Architecture decisions are made against the 3-year column; performance budgets are measured against the 12-month column.

| Dimension Launch 12 months 3 years  |           |            |             |
| ----------------------------------- | --------- | ---------- | ----------- |
| Employees                           | 500       | 2,000      | 10,000      |
| Concurrent users                    | 300       | 1,200      | 6,000       |
| Leads                               | 50,000    | 500,000    | 5,000,000   |
| Deals                               | 5,000     | 50,000     | 500,000     |
| Clients                             | 200       | 1,500      | 10,000      |
| Projects                            | 200       | 2,000      | 20,000      |
| Tasks                               | 20,000    | 250,000    | 3,000,000   |
| Attendance records / year           | 150,000   | 600,000    | 3,000,000   |
| Documents                           | 50,000    | 500,000    | 5,000,000   |
| Audit events / year                 | 2,000,000 | 20,000,000 | 200,000,000 |
| Notifications / day                 | 10,000    | 80,000     | 500,000     |
| Invoices / year                     | 3,000     | 25,000     | 200,000     |
| Journal postings / year             | 50,000    | 400,000    | 3,000,000   |

### 17.1 Tenancy

TapCRM runs a single organization at launch. It is designed on the assumption that it will eventually run more than one.

**The tenant boundary is built in from day one, even though only one tenant exists.**

| # Requirement  |                                                                                                                                                                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MT-1           | Every tenant-owned record carries `organizationId`, populated from the first migration. There is no "add it later" phase.                                                                                                        |
| MT-2           | `organizationId` is the **leading component of every index** on a tenant-owned collection.                                                                                                                                       |
| MT-3           | Every **tenant-owned** query is issued through a data-access layer that injects `organizationId` from the request context. A tenant-owned query constructed without it fails in development and test, and is refused in production.                            |
| MT-4           | Files, notifications, search indices, background jobs, WebSocket rooms and audit entries are all partitioned by `organizationId`. These are the surfaces that are painful to retrofit, which is precisely why they are done now. |
| MT-5           | **Feature code cannot perform cross-tenant reads.** The tenant DAL always enforces `organizationId`; allow-listed `platformDb` operations may operate across organizations only when explicitly required, are separately credentialed where applicable, and are audited.                                                                                                                           |
| MT-6           | Super Admin is scoped to one organization. A cross-tenant operator role, if ever needed, is a separate principal type and is out of scope for this release.                                                                      |

**What is deliberately deferred.** Which *isolation model* to adopt before onboarding a second organization — shared database with a discriminator, database-per-tenant, or hybrid — is recorded in `DECISIONS.md` BD-21. This is **not a launch blocker because TapCRM runs one organization at launch**, but BD-21 must be resolved before a second organization is onboarded. MT-1 to MT-5 establish the application-level tenant boundary now; they do not by themselves constitute the final multi-tenant security boundary.

The cost of MT-1 to MT-5 today is one indexed field and a data-access layer that should exist regardless. The cost of adding them after the first external customer is touching indexes, queries, authorization, file storage, notifications, audit, search, background jobs and WebSockets simultaneously, under production load, with real customer data. That is not a trade worth taking.

---

## 18. Release Phasing

| Phase Scope Exit criteria       |                                                                                                                                                                                |                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0 — Foundation**             | `identity`, `organization`, `access-management`, `audit`, `system-administration`. Route manifest. Authorization engine with policy registry and resource visibility policies. | A position can be created, given per-action policies, staffed, and its effect verified from the access explorer. Manifest drift fails the build. Segregation of duties blocks a self-approval in a test workflow.                                                                                                                                                                                       |
| **P1 — People**                 | `employee-directory`, `onboarding`, `live-status`, `attendance`, `shifts`, `biometric`, `holidays`, `leave`.                                                                   | Full attendance cycle runs with corrections, leave overlays and device ingestion. Every acceptance criterion in §9.1–9.9 passes.                                                                                                                                                                                                                                                                        |
| **P2 — Payroll and Governance** | `payroll`, `break-management`, `performance`.                                                                                                                                  | A full payroll cycle reconciles against attendance for every employee. Break policies live with penalties in review mode; auto-apply enabled only after one month of confirmed accuracy.                                                                                                                                                                                                                |
| **P3 — Sales**                  | `territories`, `leads`, `callbacks`, `handovers`, `deals`, `approvals`.                                                                                                        | Stages 0–3 run end to end with correct visibility at every step. An agent cannot retrieve commercials of a deal they did not close, verified by direct API test. No deal reaches `lifecycleStatus = won` above its closer's limit without a recorded decision, and payment confirmation is separately authorized.                                                                                       |
| **P4 — Delivery**               | `handoff`, `projects`, `tasks`, `resource-planning`, `delivery`.                                                                                                               | Stages 4–6 run end to end. No project exists without an accepted brief. A base employee cannot retrieve client contact data by any route.                                                                                                                                                                                                                                                               |
| **P5 — Client and Insight**     | `clients`, `post-closure`, `client-portal`, `project-communication`, `documents`, `reporting`.                                                                                 | Stage 7 runs end to end. Penetration test of client isolation finds no cross-account read.                                                                                                                                                                                                                                                                                                              |
| **P6 — Finance**                | `billing-terms`, `invoicing`, `payments`, `receivables`, `payables`, `accounting`.                                                                                             | The trial balance balances after every posting. Aging, the AR control account and the balance sheet agree to the rupee. Invoice numbering is gapless under concurrent creation. A closed period rejects every posting including from Super Admin. GSTR-1 export reconciles to the invoice register. A full month runs end to end: invoice → receipt → allocation → reconciliation → close → statements. |
| **P7 — Platform**               | `chat`, `notifications`, `workspace`, global search, mobile refinement, digests and quiet hours.                                                                               | Employee baseline fully usable on mobile. Notification audience resolution verified against the authorization engine.                                                                                                                                                                                                                                                                                   |

**Sequencing rules**

- P0 is strictly first. Everything depends on the authorization engine.
- P1 and P3 may run in parallel after P0, since they share no data.
- P2 requires P1. P4 requires P3. P5 requires P4.
- **P6 (Finance) requires P5**, because invoicing draws on clients, projects, deals and delivery, and revenue recognition depends on sign-off existing. `accounting` must be built before or alongside `invoicing`, not after — every other finance module posts to the ledger, and retrofitting double-entry to modules that were written without it is a rewrite.
- P7 may begin any time after P0 and completes last.

---

## 19. Acceptance Criteria

Release-level criteria. Module-level criteria appear with each specification and are the authoritative list for that module.

| # Criterion  |                                                                                                                                                                                                                                                             |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-1         | **Per-action scope.** A single position holds `department` reach on one module and `own` reach on another simultaneously, verified by direct API call on both.                                                                                              |
| AC-2         | **Override with scope.** One named individual holds a scope for one action that differs from their position default, with a recorded reason and a working expiry.                                                                                           |
| AC-3         | **Segregation of duties.** Every principal including Super Admin is refused when approving their own request, in every approval-bearing workflow.                                                                                                           |
| AC-4         | **Protected constraints.** Each of A1–A4 and P1–P8 has a test that attempts the prohibited action through the API and is refused.                                                                                                                           |
| AC-4b        | **Grantability.** No action with `positionGrantable = false` can be written into any Position policy through the interface or the API.                                                                                                                      |
| AC-4c        | **Credit versus value.** An originating agent who did not close a deal sees stage, lifecycle and sourcing credit, and no monetary field, unless BD-9 is enabled — in which case they see exactly `creditedValue`.                                           |
| AC-4d        | **Account boundary.** Holding account ownership yields no field of `Deal.commercials` through any endpoint.                                                                                                                                                 |
| AC-5         | **Object-level authorization.** Every endpoint operating on an object refuses a request for an object outside the caller's scope, tested per resource type.                                                                                                 |
| AC-6         | **No query leakage.** No list endpoint returns a record the caller cannot open, and no count reveals the existence of one.                                                                                                                                  |
| AC-7         | **Workflow integrity.** Each of the eight stages produces a record whose age is measurable, and each queue is visible to at least one party who can act on it.                                                                                              |
| AC-8         | **Threshold enforcement.** No deal reaches `lifecycleStatus = won` above its closer's configured limit without a recorded approval decision, a signed contract where required, and a confirmed advance payment. Each predicate is independently tested.     |
| AC-9         | **Brief gate.** No client project exists without an accepted Project Brief.                                                                                                                                                                                 |
| AC-10        | **Delivery gate.** No project is marked Delivered by anyone other than the Development Department Head, and no delivery closes without a client sign-off record.                                                                                            |
| AC-11        | **Payroll fidelity.** Attendance totals equal payslip totals for every employee across a three-month regression set, and no published payslip is mutable.                                                                                                   |
| AC-12        | **Break governance.** No status-changing break penalty applies without human confirmation unless auto-apply is explicitly configured, and every waiver reverses cleanly.                                                                                    |
| AC-13        | **Audit integrity.** Tampering with an audit entry is detected by the next integrity run.                                                                                                                                                                   |
| AC-14        | **Manifest consistency.** Every registered route has a manifest entry and every manifest entry resolves to a route; drift fails the build.                                                                                                                  |
| AC-15        | **Configurability.** Every non-protected cell in the permission matrix is changeable from the interface with no deployment, and takes effect on the next request.                                                                                           |
| AC-15b       | **Financial integrity.** The trial balance balances after every posting batch; aging, the AR control account and the balance sheet agree to the rupee; and invoice numbering is gapless within each series and financial year under concurrent creation.    |
| AC-15c       | **Financial authority.** No principal other than Super Admin can write a client billing term through any endpoint, and no principal including Super Admin can post into a closed period.                                                                    |
| AC-15d       | **Statutory correctness.** Intra-state, inter-state and export invoices carry the correct tax treatment; a TDS-short receipt closes its invoice with the balance posted to TDS Receivable; GSTR-1 export reconciles to the invoice register for the period. |
| AC-16        | **Scale.** Performance budgets in §15.1 are met at the 12-month scale targets in §17 under load test.                                                                                                                                                       |

---

## 20. Glossary

| Term Definition           |                                                                                                                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Account type**          | The coarse classification of a principal: super-admin, employee, client, service. Grants no business permissions.                                                                   |
| **Action**                | A verb string naming a capability, e.g. `deals:approve`. The unit an authorization decision is made about.                                                                          |
| **Absolute constraint**   | A rule binding every principal including Super Admin.                                                                                                                               |
| **Approval limit**        | The maximum deal value and discount a position may commit without escalation.                                                                                                       |
| **Brief**                 | See Project Brief.                                                                                                                                                                  |
| **Change request**        | A client-requested change after delivery, classified free fix or billable.                                                                                                          |
| **Chart of accounts**     | The configurable list of ledger accounts every posting is made against.                                                                                                             |
| **Credit note**           | The document that corrects or cancels an issued invoice. Invoices are never edited.                                                                                                 |
| **Deferred revenue**      | Money invoiced or received for work not yet done. A liability until earned.                                                                                                         |
| **Double-entry**          | Every posting has equal debits and credits, so the books balance by construction.                                                                                                   |
| **Dunning**               | The scheduled sequence of payment reminders sent on an overdue invoice.                                                                                                             |
| **IRN**                   | Invoice Reference Number, returned by the government portal for an e-invoice.                                                                                                       |
| **Period close**          | Locking an accounting period so nothing further posts into it.                                                                                                                      |
| **Place of supply**       | The location that decides whether an invoice carries CGST+SGST or IGST.                                                                                                             |
| **Rate card**             | A named, versioned set of prices per service for a client or client group.                                                                                                          |
| **Revenue recognition**   | Recording revenue when it is earned, which is not when it is invoiced or received.                                                                                                  |
| **TDS**                   | Tax Deducted at Source. A client paying ₹90 against a ₹100 invoice has deducted ₹10, not underpaid.                                                                                 |
| **Trial balance**         | The list of every account balance, which must sum to zero.                                                                                                                          |
| **`lifecycleStatus`**     | The commercial outcome dimension of a deal: open, won, lost or cancelled. `won` is a controlled state requiring approval, contract where applicable, and confirmed advance payment. |
| **Deal**                  | A lead that has progressed into commercial negotiation, carrying value, terms, approvals and five orthogonal state dimensions (§10.5).                                              |
| **Delegation**            | Editing another user's permission policies, bounded by ceiling, boundary, seniority and root-of-trust constraints.                                                                  |
| **Designation**           | A person's job title. Display and HR use; never authorizes.                                                                                                                         |
| **Disposition**           | The outcome recorded after a live-call handover: accepted, rejected or callback.                                                                                                    |
| **Feasibility review**    | The Development Department Head's decision on whether a Project Brief is deliverable as scoped.                                                                                     |
| **Handover**              | A live call passed from an agent to their Supervisor or Team Lead.                                                                                                                  |
| **Organizational level**  | An integer attribute used by delegation and approval routing. Not an authorization grant.                                                                                           |
| **Permission policy**     | An action plus whether it is allowed, its scope, its field policy and its constraints.                                                                                              |
| **Pool**                  | A Supervisor's group of agents. The narrowest team boundary in Sales.                                                                                                               |
| **Position**              | The unit of authority: a named, levelled, department-scoped role carrying permission policies.                                                                                      |
| **Privileged constraint** | A rule binding everyone except Super Admin.                                                                                                                                         |
| **Project Brief**         | The structured handoff package created from a deal at `lifecycleStatus = won`, and the permission boundary between Sales and Delivery.                                              |
| **Revision Needed**       | A task state set by a manager rejecting submitted work, returning it to In Progress with notes.                                                                                     |
| **Scope**                 | How far a permission reaches: own, participant, pool, team, department or all-people. There is no `all` scope; organization-wide access is a protected capability.                                                                 |
| **Segregation of duties** | The control preventing a principal from approving their own request.                                                                                                                |
| **Specialization**        | The kind of work a person does within their designation. Drives routing suggestions and reporting; never authorizes.                                                                |
| **Sub-team**              | One of the three Development units: Developer Team, Digital & Marketing, Content Team.                                                                                              |
| **Team**                  | The organizational unit bounding lateral visibility. Not project membership.                                                                                                        |
| **Territory**             | A market division by geography, vertical or product line, assigned to a sales team.                                                                                                 |

---

## 21. Appendix A — Screen Inventory

Screens grouped by navigation area. Every screen belongs to exactly one module.

### Employee baseline — every employee

| Route Screen Module  |                                         |                 |
| -------------------- | --------------------------------------- | --------------- |
| `/dashboard`         | My dashboard                            | `reporting`     |
| `/today`             | My status today, punch and break widget | `live-status`   |
| `/attendance/mine`   | My attendance and break record          | `attendance`    |
| `/leave/mine`        | My leave, balances and WFH requests     | `leave`         |
| `/payslips/mine`     | My payslips                             | `payroll`       |
| `/performance/mine`  | My performance record                   | `performance`   |
| `/tasks`             | My tasks                                | `tasks`         |
| `/profile`           | My profile, sessions, devices           | `workspace`     |
| `/notepad`           | My notepad                              | `workspace`     |
| `/todo`              | My todo                                 | `workspace`     |
| `/chat`              | Chat                                    | `chat`          |
| `/notifications`     | Notifications                           | `notifications` |
| `/notices`           | Notice board                            | `workspace`     |
| `/holidays`          | Holiday calendar                        | `holidays`      |
| `/search`            | Global search                           | `workspace`     |

### Workforce — HR and Super Admin

| Route Screen Module                 |                                 |                      |
| ----------------------------------- | ------------------------------- | -------------------- |
| `/hr`                               | HR dashboard                    | `reporting`          |
| `/workforce/directory`              | Employee directory              | `employee-directory` |
| `/workforce/directory/:id`          | Employee 360                    | `employee-directory` |
| `/workforce/onboarding`             | Onboarding and offboarding      | `onboarding`         |
| `/workforce/live`                   | Live status board               | `live-status`        |
| `/workforce/attendance`             | Attendance portal               | `attendance`         |
| `/workforce/attendance/corrections` | Corrections queue               | `attendance`         |
| `/workforce/breaks`                 | Break policies                  | `break-management`   |
| `/workforce/breaks/breaches`        | Breach queue                    | `break-management`   |
| `/workforce/breaks/assignments`     | Policy assignments              | `break-management`   |
| `/workforce/shifts`                 | Shift templates and assignment  | `shifts`             |
| `/workforce/shifts/requests`        | Shift request queue             | `shifts`             |
| `/workforce/biometric`              | Device registry and mapping     | `biometric`          |
| `/workforce/leave`                  | Leave queue, calendar, balances | `leave`              |
| `/workforce/holidays`               | Holiday management              | `holidays`           |
| `/workforce/payroll`                | Payroll cycles and runs         | `payroll`            |
| `/workforce/payroll/structures`     | Salary structures               | `payroll`            |
| `/workforce/payroll/payslips`       | Payslip register                | `payroll`            |
| `/workforce/performance`            | Performance overview            | `performance`        |
| `/workforce/notepads`               | All notepads (Super Admin)      | `workspace`          |

### Sales

| Route Screen Module         |                          |                |
| --------------------------- | ------------------------ | -------------- |
| `/sales/territories`        | Territories and routing  | `territories`  |
| `/sales/leads`              | Lead list and board      | `leads`        |
| `/sales/leads/:id`          | Lead detail              | `leads`        |
| `/sales/leads/unrouted`     | Unrouted queue           | `territories`  |
| `/sales/lost-review`        | Weekly lost-lead review  | `leads`        |
| `/sales/re-engagement`      | Re-engagement segments   | `leads`        |
| `/sales/callbacks`          | List, calendar, board    | `callbacks`    |
| `/sales/handovers/incoming` | Incoming handover offers | `handovers`    |
| `/sales/handovers`          | All handovers            | `handovers`    |
| `/sales/deals`              | Deal list and pipeline   | `deals`        |
| `/sales/deals/:id`          | Deal detail              | `deals`        |
| `/sales/wins`               | Wins to record           | `deals`        |
| `/sales/forecast`           | Pipeline forecast        | `deals`        |
| `/sales/approvals`          | My approval queue        | `approvals`    |
| `/sales/teams`              | Teams and pools          | `organization` |

### Delivery

| Route Screen Module    |                                |                     |
| ---------------------- | ------------------------------ | ------------------- |
| `/handoff`             | Brief queue                    | `handoff`           |
| `/handoff/feasibility` | Feasibility review queue       | `handoff`           |
| `/handoff/:id`         | Brief detail and review thread | `handoff`           |
| `/projects`            | Project list and board         | `projects`          |
| `/projects/:id`        | Project detail, tabbed         | `projects`          |
| `/tasks/team`          | Team board                     | `tasks`             |
| `/tasks/reviews`       | Review queue                   | `tasks`             |
| `/tasks/department`    | Department board               | `tasks`             |
| `/capacity`            | Capacity and allocation        | `resource-planning` |
| `/delivery`            | Delivery queue                 | `delivery`          |
| `/delivery/changes`    | Change request queue           | `delivery`          |

### Business

| Route Screen Module  |                                |                         |
| -------------------- | ------------------------------ | ----------------------- |
| `/clients`           | Client list                    | `clients`               |
| `/clients/:id`       | Client detail, tabbed          | `clients`               |
| `/clients/mine`      | My accounts                    | `post-closure`          |
| `/renewals`          | Renewal pipeline               | `post-closure`          |
| `/communication`     | Communication tracker          | `project-communication` |
| `/documents`         | Document library and templates | `documents`             |
| `/reports`           | Reports and report builder     | `reporting`             |

### Finance

| Route Screen Module                 |                                     |                 |
| ----------------------------------- | ----------------------------------- | --------------- |
| `/finance`                          | Finance dashboard                   | `reporting`     |
| `/finance/billing-terms`            | Client billing terms and rate cards | `billing-terms` |
| `/finance/invoices`                 | Invoice list                        | `invoicing`     |
| `/finance/invoices/new`             | Create invoice                      | `invoicing`     |
| `/finance/invoices/:id`             | Invoice detail                      | `invoicing`     |
| `/finance/recurring`                | Recurring schedules                 | `invoicing`     |
| `/finance/credit-notes`             | Credit and debit notes              | `invoicing`     |
| `/finance/e-invoicing`              | e-Invoicing queue                   | `invoicing`     |
| `/finance/receipts`                 | Receipts and allocation             | `payments`      |
| `/finance/reconciliation`           | Bank reconciliation                 | `payments`      |
| `/finance/aging`                    | Aging and collections               | `receivables`   |
| `/finance/statements`               | Client statements                   | `receivables`   |
| `/finance/tds`                      | TDS reconciliation                  | `receivables`   |
| `/finance/bills`                    | Vendor bills                        | `payables`      |
| `/finance/payment-runs`             | Payment runs                        | `payables`      |
| `/finance/accounts`                 | Chart of accounts                   | `accounting`    |
| `/finance/journals`                 | Journal entries                     | `accounting`    |
| `/finance/ledger`                   | General ledger                      | `accounting`    |
| `/finance/trial-balance`            | Trial balance                       | `accounting`    |
| `/finance/close`                    | Period close                        | `accounting`    |
| `/finance/statements/pnl`           | Profit and loss                     | `accounting`    |
| `/finance/statements/balance-sheet` | Balance sheet                       | `accounting`    |
| `/finance/statements/cash-flow`     | Cash flow                           | `accounting`    |
| `/finance/tax`                      | Tax filing exports                  | `accounting`    |
| `/expenses/mine`                    | My reimbursement claims             | `payables`      |
| `/expenses/approvals`               | Reimbursement approvals             | `payables`      |

### Administration — Super Admin

| Route Screen Module         |                               |                         |
| --------------------------- | ----------------------------- | ----------------------- |
| `/admin`                    | Super Admin dashboard         | `reporting`             |
| `/admin/departments`        | Departments                   | `organization`          |
| `/admin/positions`          | Position ladder and editor    | `organization`          |
| `/admin/org-chart`          | Org chart                     | `organization`          |
| `/admin/access`             | Access explorer and overrides | `access-management`     |
| `/admin/access/assignments` | Employee assignment           | `access-management`     |
| `/admin/access/requests`    | Role-change requests          | `access-management`     |
| `/admin/thresholds`         | Approval thresholds           | `system-administration` |
| `/admin/settings`           | General settings              | `system-administration` |
| `/admin/integrations`       | Integrations                  | `system-administration` |
| `/admin/notifications`      | Notification rules            | `system-administration` |
| `/admin/retention`          | Data retention policy         | `system-administration` |
| `/admin/audit`              | Audit log                     | `audit`                 |
| `/admin/audit/holds`        | Legal holds                   | `audit`                 |
| `/admin/geofencing`         | Geofence locations            | `identity`              |

### Client portal

| Route Screen Module            |                                         |                 |
| ------------------------------ | --------------------------------------- | --------------- |
| `/client`                      | Client dashboard                        | `client-portal` |
| `/client/projects`             | My projects                             | `client-portal` |
| `/client/projects/:id`         | Project view                            | `client-portal` |
| `/client/projects/:id/signoff` | Delivery sign-off                       | `delivery`      |
| `/client/requests`             | My requests                             | `clients`       |
| `/client/billing`              | Invoices, payments, statement, disputes | `clients`       |
| `/client/profile`              | My profile                              | `client-portal` |

---

## 22. Appendix B — Permission Action Reference

Actions are namespaced by module. Each resolves to exactly one policy carrying its own scope. This is the authoritative list; `AUTHORIZATION.md` specifies how each is evaluated.

### Foundation

| Action Grants                |                                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| `identity:manage-geofence`   | Geofence locations and assignments                                                           |
| `identity:unlock-account`    | Release a locked account                                                                     |
| `org:view-structure`         | Departments, teams, position names and the ladder shape. No people, no policies.             |
| `org:view-people`            | Who holds which position and who reports to whom. No policies, no compensation.              |
| `org:view-policies`          | The permission policies attached to a position. Effectively read access to the access model. |
| `org:manage-departments`     | Create and edit departments                                                                  |
| `org:manage-teams`           | Create teams and pools, move members                                                         |
| `org:manage-positions`       | Create and edit positions, including custom ones                                             |
| `org:manage-designations`    | Designations and specializations                                                             |
| `access:view`                | Read effective access for a person or capability                                             |
| `access:delegate`            | Edit another user's permission policies                                                      |
| `access:request-role-change` | Raise a position change for decision                                                         |
| `access:decide-role-change`  | Decide a role-change request                                                                 |
| `audit:view`                 | Read the audit trail                                                                         |
| `audit:export`               | Export audit entries                                                                         |
| `audit:manage-holds`         | Place and lift legal holds                                                                   |
| `system:manage-settings`     | Global settings and feature flags                                                            |
| `system:manage-thresholds`   | Approval threshold configuration                                                             |
| `system:manage-integrations` | Integration configuration                                                                    |
| `system:manage-retention`    | Retention policy                                                                             |

### People

| Action Grants                   |                                              |
| ------------------------------- | -------------------------------------------- |
| `users:view`                    | Read employee records                        |
| `users:manage`                  | Create, edit and change employment status    |
| `onboarding:manage`             | Onboarding and offboarding workflows         |
| `attendance:view-live`          | The live status board                        |
| `attendance:view`               | Attendance records and reports               |
| `attendance:export`             | Export attendance                            |
| `attendance:correct`            | Apply and approve corrections                |
| `attendance:request-correction` | Request a correction on own record           |
| `breaks:manage-policy`          | Break limits and penalty rules               |
| `breaks:review-breach`          | Confirm or waive a breach                    |
| `breaks:view`                   | Read breaches and allowance                  |
| `shifts:view`                   | Read shift assignments                       |
| `shifts:manage`                 | Templates, rotations and assignment          |
| `shifts:approve`                | Decide change and flexible requests          |
| `biometric:manage`              | Devices, mapping and punch stream            |
| `leave:view`                    | Read leave records                           |
| `leave:request`                 | Raise leave                                  |
| `leave:request-wfh`             | Raise a Work From Home request               |
| `leave:manage-wfh-standing`     | Approve or revoke a standing WFH arrangement |
| `leave:acknowledge`             | Manager acknowledgement stage                |
| `leave:decide`                  | Approve or reject                            |
| `leave:manage-types`            | Leave types and balance configuration        |
| `holidays:view`                 | Read the calendar                            |
| `holidays:manage`               | Manage the calendar                          |
| `payroll:view`                  | Read payslips                                |
| `payroll:manage`                | Generate, edit and publish runs              |
| `payroll:manage-config`         | Statutory configuration                      |
| `performance:view`              | Read performance records                     |
| `performance:view-aggregates`   | Derived KPIs without record access           |
| `performance:manage`            | Write reviews and manage cycles              |

### Sales

| Action Grants                  |                                                      |
| ------------------------------ | ---------------------------------------------------- |
| `territories:view`             | Read territories and routing                         |
| `territories:manage`           | Define territories and routing rules                 |
| `leads:view`                   | Read leads                                           |
| `leads:create`                 | Create a lead                                        |
| `leads:edit`                   | Edit a lead                                          |
| `leads:reassign`               | Change lead ownership                                |
| `callbacks:view`               | Read callbacks                                       |
| `callbacks:create`             | Schedule a callback                                  |
| `callbacks:edit`               | Edit or record an outcome                            |
| `handovers:initiate`           | Offer a live call upward                             |
| `handovers:receive`            | Accept or decline an offer                           |
| `handovers:record-disposition` | Record the outcome                                   |
| `handovers:view`               | Read handover records                                |
| `deals:view`                   | Read deals                                           |
| `deals:view-commercials`       | Read value, discount and terms                       |
| `deals:create`                 | Open a commercial record                             |
| `deals:edit`                   | Edit deal fields                                     |
| `deals:approve`                | Decide within approval limits                        |
| `deals:allow-custom-terms`     | Vary standard contract terms                         |
| `deals:approve-contract`       | Contract issuance and payment sign-off               |
| `deals:confirm-payment`        | Confirm advance payment received                     |
| `deals:record-win`             | Set `lifecycleStatus = won` once all predicates hold |
| `deals:forecast`               | Read the pipeline forecast                           |
| `approvals:decide`             | Act on an approval queue item                        |
| `approvals:delegate`           | Nominate an out-of-office delegate                   |

### Delivery

| Action Grants                   |                                                                          |
| ------------------------------- | ------------------------------------------------------------------------ |
| `handoff:create`                | Draft a Project Brief from a won deal (Sales Head)                       |
| `handoff:confirm`               | Confirm or query back a drafted brief (Project Manager)                  |
| `handoff:review`                | Decide feasibility (Development Department Head)                         |
| `handoff:view`                  | Read briefs                                                              |
| `projects:view`                 | Read projects                                                            |
| `projects:manage`               | Create, edit and assign                                                  |
| `projects:view-financials`      | Budget and profitability                                                 |
| `tasks:view`                    | Read tasks                                                               |
| `tasks:assign`                  | Create and assign                                                        |
| `tasks:update`                  | Move own task through the lifecycle                                      |
| `tasks:review`                  | Mark Done or Revision Needed                                             |
| `tasks:manage-dependencies`     | Create dependencies, including cross-sub-team                            |
| `tasks:log-time`                | Record time against a task                                               |
| `resources:view`                | Capacity and workload                                                    |
| `resources:allocate`            | Allocate people to work                                                  |
| `resources:override-allocation` | Reject or reassign a PM-originated assignment on capacity grounds (PA-4) |
| `delivery:view`                 | Read delivery records and change requests                                |
| `delivery:approve`              | Mark a project Delivered                                                 |
| `delivery:share`                | Share a deliverable with a client                                        |
| `delivery:signoff`              | Client sign-off                                                          |
| `changes:classify`              | Free fix or billable                                                     |
| `changes:assign`                | Route a change to a sub-team                                             |

### Finance

| Action Grants                |                                                                      |
| ---------------------------- | -------------------------------------------------------------------- |
| `billing:view-terms`         | Read a client's rate card, payment terms and credit limit            |
| `billing:set-terms`          | **Write** what a client pays. Super Admin only, never grantable (P8) |
| `invoicing:view`             | Read invoices                                                        |
| `invoicing:create`           | Raise an invoice from configured terms                               |
| `invoicing:issue`            | Issue a draft, allocating a statutory number                         |
| `invoicing:send`             | Send an issued invoice to the client                                 |
| `invoicing:credit-note`      | Raise a credit or debit note                                         |
| `invoicing:manage-recurring` | Create and amend recurring schedules                                 |
| `invoicing:manage-series`    | Configure numbering series                                           |
| `payments:view`              | Read receipts                                                        |
| `payments:record`            | Record a receipt                                                     |
| `payments:allocate`          | Allocate a receipt to invoices                                       |
| `payments:refund`            | Raise a refund                                                       |
| `payments:reconcile`         | Perform bank reconciliation                                          |
| `receivables:view`           | Aging, statements, collections queue                                 |
| `receivables:dun`            | Send or configure dunning                                            |
| `receivables:write-off`      | Write off a bad debt, capped by the client ceiling                   |
| `payables:view`              | Read vendor bills and claims                                         |
| `payables:create-bill`       | Enter a vendor bill                                                  |
| `payables:approve-bill`      | Approve a bill for payment                                           |
| `payables:claim`             | Submit an expense reimbursement claim                                |
| `payables:approve-claim`     | Approve a reimbursement claim                                        |
| `payables:execute-run`       | Execute a payment run                                                |
| `accounting:view-ledger`     | General ledger and trial balance                                     |
| `accounting:post-journal`    | Post a manual journal entry                                          |
| `accounting:manage-accounts` | Configure the chart of accounts                                      |
| `accounting:close-period`    | Close an accounting period                                           |
| `accounting:reopen-period`   | Reopen a closed period. Super Admin only (A4)                        |
| `accounting:view-statements` | Profit and loss, balance sheet, cash flow                            |
| `accounting:tax-export`      | GSTR and TDS filing exports                                          |

### Client and Cross-Cutting

| Action Grants                 |                                                           |
| ----------------------------- | --------------------------------------------------------- |
| `clients:view`                | Read client records                                       |
| `clients:manage`              | Create, edit and issue credentials                        |
| `clients:manage-requests`     | Act on client requests                                    |
| `accounts:manage-ownership`   | Transfer account ownership with reason and effective date |
| `accounts:view-revenue`       | Revenue history per account                               |
| `renewals:view`               | Renewal pipeline                                          |
| `communication:view`          | The communication tracker                                 |
| `communication:client-thread` | Post in a client thread                                   |
| `documents:view`              | Read documents                                            |
| `documents:upload`            | Upload documents                                          |
| `documents:share-client`      | Share a document with a client                            |
| `documents:manage-templates`  | Template library                                          |
| `reports:view`                | Standard reports and dashboards                           |
| `reports:build`               | Custom report builder                                     |
| `reports:export`              | Export any report or list                                 |
| `reports:view-financial`      | Financial reporting                                       |
| `reports:view-lifecycle`      | The cross-department lifecycle report                     |
| `notices:manage`              | Publish notices                                           |
| `notepad:view-all`            | Read all notepads (Super Admin only)                      |
| `sheets:manage`               | Manage the sheet registry                                 |

---

*End of document.*

**Change control.** Every numbered rule in this document is referenced by the test plan. Changing a rule requires updating its test.

Adding a module requires four coordinated edits: the catalog in §5, the build classification in §5.7, the permission matrix in §6, and the screen inventory in §20. A CI check asserts all four lists contain the same module set.

Adding an action requires three coordinated edits: Appendix B here, a row in the action registry (`AUTHORIZATION.md` §6.4), and at least one API binding (§6.5). Eight CI checks (§6.6) assert that the three stay in step — a build goes red if an action exists in one place and not the others.