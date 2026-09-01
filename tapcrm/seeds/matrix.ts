/**
 * The Permission Matrix — PRD §6, made executable per TECH.md §7.
 *
 * NF-22b: the matrix is a HUMAN-READABLE SUMMARY, not an executable artefact.
 * The Action Registry is authoritative. This file is the mechanical translation
 * TECH.md §7 requires "so that no implementer has to infer what a cell means",
 * and MX-3 requires CI to regenerate the matrix from the seed and diff it.
 *
 * ─────────────────────────────────────────────────────────────────────
 * A defect in the source table, and how it is resolved here
 *
 * §6's header names TWELVE positions:
 *
 *   Super Admin · HR · HR Exec · Sales Head · Project Mgr · Dev Dept Head ·
 *   Sales Team Lead · Sub-team Mgr · Sales Supervisor · Agent / Dev ·
 *   Employee · Client
 *
 * but every one of the 42 data rows carries ELEVEN values. One column's worth
 * of data is missing, or one header label is over-split — the table does not
 * line up either way.
 *
 * Reading it as eleven columns, with "Agent / Dev" and "Employee" collapsed
 * into a single base-employee column, makes every row align. It is also wrong,
 * and expensively so: the sales rows in that column were plainly written about
 * the Sales AGENT, and the people rows about EVERY EMPLOYEE. Collapsing them
 * hands both readings to everybody, which is how a seeded database ends up with
 * a Content Writer holding `deals:approve`, `deals:record-win` and
 * `deals:confirm-payment`.
 *
 * So the column is split back into two here, and each row is assigned the
 * meaning §6.1's own prose gives it:
 *
 *   §6.1 "`payables` is `own` for EVERY EMPLOYEE. That cell is expense
 *        reimbursement."                              → both columns
 *   §6.1 "Agents have `own` on clients and post-closure, because they own the
 *        account relationship after closure."         → agent only
 *
 * Confirmed with the product owner: a Developer, Content Writer or Marketing
 * Executive holds nothing in leads, callbacks, handovers, deals, approvals,
 * clients or post-closure.
 *
 * §6.2 makes every non-protected cell editable from Access Management without a
 * deployment, so none of this is irreversible — but it is the starting
 * authority of every position, which is exactly why it is written down rather
 * than inferred.
 * ─────────────────────────────────────────────────────────────────────
 */

import type { ModuleName } from '@tapcrm/contracts';

/** The twelve columns, in the order §6 lists them. */
export const MATRIX_POSITIONS = [
  'super-admin',
  'hr',
  'hr-executive',
  'sales-head',
  'project-manager',
  'dev-dept-head',
  'sales-team-lead',
  'sub-team-manager',
  'sales-supervisor',
  'sales-agent',
  'base-employee',
  'client',
] as const;

export type MatrixPosition = (typeof MATRIX_POSITIONS)[number];

/**
 * §7.1 cell grammar:
 *
 *   glob        No policy rows. Held by accountType = 'super-admin'.
 *   acct        No policy rows. Client isolation is A2, applied before policy.
 *   —           No rows. Absent means denied.
 *   <scope>     A row for EVERY action of that module at that scope.
 *   <scope>*    A row for the module's read action(s) ONLY. No write rows.
 */
export type Cell =
  | 'glob'
  | 'acct'
  | '—'
  | 'own'
  | 'participant'
  | 'pool'
  | 'team'
  | 'department'
  | 'all-people'
  | 'own*'
  | 'participant*'
  | 'pool*'
  | 'team*'
  | 'department*'
  | 'all-people*';

// Shorthand so the table below stays readable at 12 columns wide.
const G = 'glob' as const;
const A = 'acct' as const;
const _ = '—' as const;
const own = 'own' as const;
const par = 'participant' as const;
const pool = 'pool' as const;
const team = 'team' as const;
const dept = 'department' as const;
const all = 'all-people' as const;
const ownV = 'own*' as const;
const parV = 'participant*' as const;
const teamV = 'team*' as const;
const deptV = 'department*' as const;
const allV = 'all-people*' as const;

/**
 * PRD §6, transcribed. Column order is MATRIX_POSITIONS.
 *
 * The two rightmost employee columns are the split described above: `Agent`
 * carries the sales-domain reading of the source column, `Empl` the
 * every-employee reading. Where §6.1 says the cell applies to everyone, both
 * carry it.
 *
 *        SA   HR    HRx    SalesHd  PM     DevHd   STL    SubMgr  Sup   Agent  Empl   Client
 */
export const PERMISSION_MATRIX: Readonly<Record<ModuleName, readonly Cell[]>> = {
  identity:                [G, _,    _,    _,     _,    _,     _,    _,     _,    _,    _,    _],
  organization:            [G, deptV, _,   deptV, deptV, deptV, _,   _,     _,    _,    _,    _],
  'access-management':     [G, _,    _,    _,     _,    _,     _,    _,     _,    _,    _,    _],
  audit:                   [G, allV, _,    _,     _,    _,     _,    _,     _,    _,    _,    _],
  'system-administration': [G, _,    _,    _,     _,    _,     _,    _,     _,    _,    _,    _],

  'employee-directory':    [G, all,  all,  deptV, _,    deptV,  _,   _,     _,    _,    _,    _],
  // Your own onboarding checklist — §9.2, every employee.
  onboarding:              [G, all,  all,  _,     _,    _,     _,    _,     _,    own,  own,  _],
  'live-status':           [G, all,  all,  own,   own,  own,   team, team,  pool, own,  own,  _],
  attendance:              [G, all,  all,  own,   own,  own,   own,  own,   own,  own,  own,  _],
  'break-management':      [G, all,  allV, teamV, own,  teamV, team, team,  pool, own,  own,  _],
  shifts:                  [G, all,  all,  own,   own,  own,   own,  own,   own,  own,  own,  _],
  biometric:               [G, all,  _,    _,     _,    _,     _,    _,     _,    _,    _,    _],
  leave:                   [G, all,  all,  own,   own,  own,   own,  own,   own,  own,  own,  _],
  // §6.1 — "genuinely company-wide read-only data."
  holidays:                [G, all,  allV, allV,  allV, allV,  allV, allV,  allV, allV, allV, _],
  payroll:                 [G, all,  _,    own,   own,  own,   own,  own,   own,  own,  own,  _],
  performance:             [G, all,  all,  team,  own,  team,  team, team,  pool, own,  own,  _],

  // ── Sales. §6.1: the pipeline belongs to Sales roles. A Developer, Content
  //    Writer or Marketing Executive holds nothing here.
  territories:             [G, _,    _,    dept,  _,    _,     team, _,     _,    _,    _,    _],
  leads:                   [G, _,    _,    dept,  _,    _,     team, _,     pool, own,  _,    _],
  callbacks:               [G, _,    _,    dept,  _,    _,     team, _,     pool, own,  _,    _],
  handovers:               [G, _,    _,    dept,  _,    _,     team, _,     pool, own,  _,    _],
  deals:                   [G, _,    _,    dept,  parV, _,     team, _,     pool, own,  _,    _],
  approvals:               [G, _,    _,    dept,  _,    _,     team, _,     pool, par,  _,    _],

  handoff:                 [G, _,    _,    par,   par,  par,   _,    _,     _,    _,    _,    _],
  projects:                [G, _,    _,    _,     own,  dept,  _,    team,  _,    own,  own,  A],
  tasks:                   [G, _,    _,    _,     own,  dept,  team, team,  pool, own,  own,  _],
  'resource-planning':     [G, _,    _,    _,     ownV, dept,  team, team,  _,    _,    _,    _],
  delivery:                [G, _,    _,    _,     par,  par,   _,    teamV, _,    _,    _,    A],

  // §6.1 — "Agents have own on clients and post-closure, because they own the
  // account relationship after closure."
  clients:                 [G, _,    _,    dept,  own,  deptV, team, _,     pool, own,  _,    A],
  'post-closure':          [G, _,    _,    dept,  own,  _,     team, _,     pool, own,  _,    _],
  'client-portal':         [G, _,    _,    dept,  own,  _,     _,    _,     _,    _,    _,    A],

  'billing-terms':         [G, _,    _,    _,     _,    _,     _,    _,     _,    _,    _,    _],
  invoicing:               [G, _,    _,    _,     ownV, _,     _,    _,     _,    _,    _,    A],
  payments:                [G, _,    _,    _,     ownV, _,     _,    _,     _,    _,    _,    A],
  receivables:             [G, _,    _,    _,     ownV, _,     _,    _,     _,    _,    _,    A],
  // §6.1 — "That cell is expense reimbursement: an employee submits their own
  // claims and sees their own status. It is not visibility of company payables."
  payables:                [G, _,    _,    _,     _,    _,     _,    _,     _,    own,  own,  _],
  accounting:              [G, _,    _,    _,     _,    _,     _,    _,     _,    _,    _,    _],

  chat:                    [G, dept, dept, dept,  dept, dept,  dept, dept,  dept, dept, dept, _],
  'project-communication': [G, _,    _,    _,     own,  dept,  _,    team,  _,    _,    _,    A],
  documents:               [G, all,  all,  dept,  own,  dept,  team, team,  pool, own,  own,  A],
  reporting:               [G, all,  allV, dept,  own,  dept,  team, team,  pool, own,  own,  A],
  notifications:           [G, own,  own,  own,   own,  own,   own,  own,   own,  own,  own,  A],
  workspace:               [G, own,  own,  own,   own,  own,   own,  own,   own,  own,  own,  _],
};

/**
 * Actions never emitted for a cell whose scope is `own`.
 *
 * §7.3 expands `<scope>` to EVERY action of the module, which is right for a
 * reach like `department` and wrong for `own`. `payroll` is `own` for every
 * position below HR — meaning "my own payslip" — but a literal expansion also
 * hands out `payroll:manage` and `payroll:manage-config`. The same shape
 * repeats across attendance, shifts, leave, breaks and deals.
 *
 * The distinguishing property is REACH, not the verb. An action that decides
 * something for other people, or configures the system, is not something a cell
 * bounded to the holder themselves was ever granting. So it is excluded when
 * the scope is `own`, and emitted normally at `pool`, `team`, `department` and
 * `all-people`, where the cell really is granting authority.
 *
 * `participant` is deliberately NOT treated this way. It is the two-sided
 * workflow scope, and §6.1 is explicit that it carries real authority: "The
 * Project Manager and the Development Department Head are the two named parties
 * to every brief and every delivery, so participant scope gives each of them
 * their complete queue." Excluding administrative actions there would take the
 * feasibility decision away from the Development Department Head.
 *
 * MX-1 — declared data, listed in one place, not a condition in the generator.
 */
export const NEVER_AT_OWN_SCOPE: readonly string[] = [
  // People authority. §6.1: "Line managers do not receive subordinate
  // people-data through team scope. People data is HR's domain."
  'payroll:manage',
  'payroll:manage-config',
  'attendance:correct',
  'shifts:manage',
  'shifts:approve',
  'breaks:manage-policy',
  'breaks:review-breach',
  'leave:decide',
  'leave:manage-types',
  'leave:manage-wfh-standing',
  'leave:acknowledge',
  'holidays:manage',
  'performance:manage',
  'biometric:manage',
  'users:manage',
  'identity:manage-geofence',
  'identity:unlock-account',

  // Commercial authority — the §7.2 approval ladder and the §7.4 win gate.
  // AC-8: no deal reaches `won` above its closer's limit without a recorded
  // decision, a signed contract and a confirmed advance payment.
  'deals:approve',
  'deals:approve-contract',
  'deals:record-win',
  'deals:confirm-payment',
  'deals:allow-custom-terms',
  'approvals:decide',
  'approvals:delegate',
  'territories:manage',
  // §12.2 — ownership transfer is an explicit, audited act (OWN-1).
  'accounts:manage-ownership',

  // Delivery authority. PA-6: assigning work and judging it are separate acts.
  // AC-10: only the Development Department Head marks a project Delivered.
  'tasks:review',
  'resources:allocate',
  'resources:override-allocation',
  'delivery:approve',
  'changes:classify',
  'handoff:review',

  // Configuration and company-wide surfaces.
  'documents:manage-templates',
  'notices:manage',
  'org:manage-departments',
  'org:manage-teams',
  'org:manage-positions',
  'org:manage-designations',
  'access:delegate',
  'access:decide-role-change',
  'audit:manage-holds',
  'audit:export',
  'system:manage-integrations',
  'system:manage-retention',
  'system:manage-settings',
  'system:manage-thresholds',

  // `onboarding:manage` is deliberately ABSENT. §9.2's module has exactly one
  // action, and at `own` scope it is an employee working through their own
  // checklist, not authority over anybody's onboarding but their own. Excluding
  // it emptied the cell — which the seed's MX-2 gate caught, correctly.

  // Sensitive rather than administrative, and listed for that reason: §6.1
  // gives a Project Manager financial visibility of their own accounts through
  // `invoicing`, `payments` and `receivables`, not through the reporting
  // module's financial slice.
  'reports:view-financial',
];

/**
 * §7.3 carve-outs — exceptions the scope rule above cannot express, because
 * they are about a specific position rather than about reach.
 *
 * MX-1: "Every carve-out is DECLARED DATA, not a condition in the generator. A
 * reader can list every exception in one place." Each entry names the rule it
 * implements, so a reviewer can check it against the PRD rather than trust it.
 */
export const CARVE_OUTS: Readonly<Partial<Record<MatrixPosition, readonly string[]>>> = {
  'project-manager': [
    // PA-6 — "Sub-team managers judge the work. Assigning a task and marking it
    // Done are different acts." A naïve expansion of `tasks` = own would grant it.
    'tasks:review',
    // OR-13 — the access model is not organizational information.
    'org:view-policies',
    // AC-10 — "No project is marked Delivered by anyone other than the
    // Development Department Head." The PM is a named party to the delivery
    // (`part`), which is how they see its queue; it is not authority to close it.
    'delivery:approve',
    // §7.5 — the PM confirms the brief; drafting is Sales' and the feasibility
    // decision is the Development Department Head's (§11.1).
    'handoff:create',
    'handoff:review',
  ],

  // OR-13 — branch heads hold `org:view-structure` and `org:view-people` scoped
  // to their own department, plus structure-only visibility elsewhere. They do
  // NOT hold `org:view-policies`: "the access model is visible only to Super
  // Admin and to access:view holders." Without this, `organization` = dept*
  // would expand across all three read capabilities and hand every branch head
  // the permission model.
  // §7.5 Stage 4 — "Sales Head DRAFTS → PM CONFIRMS → Dev Dept Head REVIEWS".
  // All three are named parties to the brief, which is why the cell is `part`
  // for each of them; being a party is not the same as holding every act on it.
  'sales-head': ['org:view-policies', 'handoff:confirm', 'handoff:review'],
  'dev-dept-head': ['org:view-policies', 'handoff:create', 'handoff:confirm'],
  hr: ['org:view-policies'],

  // §2.3 — "HR Executive: Executes HR operations: data entry, onboarding steps,
  // attendance logging. No payroll, NO FINAL APPROVALS."
  'hr-executive': ['leave:decide'],

  // §7.2 — the ladder starts at the Supervisor: "Sales Supervisor: first
  // escalation point; approves small discounts." An Agent is a party to the
  // approval on their own deal (`part`), which is visibility, not a vote.
  // A1 would block them approving what they raised; this stops them voting on
  // one a colleague raised.
  'sales-agent': ['approvals:decide', 'approvals:delegate'],

  // §3.3 — "The Sales Department Head owns … approval authority above a Team
  // Lead's limit, contract and payment sign-off, and win confirmation."
  // §7.4 — Stage 3 Win Confirmation is the Sales Department Head's.
  'sales-supervisor': [
    'deals:record-win',
    'deals:approve-contract',
    'deals:confirm-payment',
    // §7.2 — custom terms are a Team Lead's call, not a Supervisor's.
    'deals:allow-custom-terms',
  ],
  'sales-team-lead': ['deals:record-win', 'deals:approve-contract', 'deals:confirm-payment'],
};

/**
 * Actions never emitted for ANY position, whatever cell would produce them.
 *
 * §7.3: `billing-terms` at any scope never includes `billing:set-terms`
 * (positionGrantable = false, P8). The seed ASSERTS this and fails if a matrix
 * cell would produce it, rather than filtering quietly.
 *
 * The generator derives this set from the registry's `positionGrantable = false`
 * flag rather than hard-coding names, so a future non-grantable action is
 * covered automatically. The two names below are what that currently resolves
 * to, recorded here for the reader.
 */
export const NEVER_POSITION_GRANTABLE = ['notepad:view-all', 'billing:set-terms'] as const;
