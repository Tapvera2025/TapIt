/**
 * The Permission Matrix — PRD §6, made executable per TECH.md §7.
 *
 * NF-22b: the matrix is a HUMAN-READABLE SUMMARY, not an executable artefact.
 * The Action Registry is authoritative. This file is the mechanical translation
 * TECH.md §7 requires "so that no implementer has to infer what a cell means",
 * and MX-3 requires CI to regenerate the matrix from the seed and diff it.
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠ ONE INTERPRETATION WAS REQUIRED. Please confirm.
 *
 * The §6 table's header names TWELVE positions:
 *
 *   Super Admin · HR · HR Exec · Sales Head · Project Mgr · Dev Dept Head ·
 *   Sales Team Lead · Sub-team Mgr · Sales Supervisor · Agent / Dev ·
 *   Employee · Client
 *
 * but every one of the 42 data rows carries ELEVEN values. One column's worth
 * of data is missing, or one header label is over-split.
 *
 * Read as eleven columns — with "Agent / Dev" and "Employee" being ONE column,
 * `Agent / Dev / Employee`, the base-employee baseline — every row aligns with
 * the prose in §6.1:
 *
 *   `payables`     §6.1: "own for EVERY EMPLOYEE ... an employee submits their
 *                  own claims". The row has exactly one `own`, in that column.
 *   `live-status`  §6.1: managers get `team`; the row is
 *                  …, team, team, pool, own, — which lands `own` on the
 *                  baseline and `—` on Client.
 *   `deals`        §6.1: PM is `part*`, sub-team manager is absent. The row is
 *                  glob, —, —, dept, part*, —, team, —, pool, own, —.
 *
 * Read as twelve, every row would be short by one and the alignment above
 * would break. So eleven is taken as correct.
 *
 * This is a seeded DEFAULT, not a protected rule — §6.2 makes every
 * non-protected cell editable from Access Management with no deployment. But
 * it is still the starting authority of every position, so it is flagged rather
 * than quietly resolved.
 * ─────────────────────────────────────────────────────────────────────
 */

import type { ModuleName } from '@tapcrm/contracts';

/** The eleven columns, in the order the §6 rows list them. */
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
  // "Agent / Dev" and "Employee" read as one column — see the note above.
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
 *   <scope>*    A row for the module's :view action ONLY. No write rows.
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

// Shorthand so the table below stays readable at 11 columns wide.
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
 *        SA   HR    HRx   Sales Head  PM     DevHead  STL    SubMgr  Sup    Base   Client
 */
export const PERMISSION_MATRIX: Readonly<Record<ModuleName, readonly Cell[]>> = {
  identity:                [G, _,    _,    _,     _,    _,     _,    _,     _,    _,    _],
  organization:            [G, deptV, _,   deptV, deptV, deptV, _,   _,     _,    _,    _],
  'access-management':     [G, _,    _,    _,     _,    _,     _,    _,     _,    _,    _],
  audit:                   [G, allV, _,    _,     _,    _,     _,    _,     _,    _,    _],
  'system-administration': [G, _,    _,    _,     _,    _,     _,    _,     _,    _,    _],

  'employee-directory':    [G, all,  all,  deptV, _,    deptV,  _,   _,     _,    _,    _],
  onboarding:              [G, all,  all,  _,     _,    _,     _,    _,     _,    own,  _],
  'live-status':           [G, all,  all,  own,   own,  own,   team, team,  pool, own,  _],
  attendance:              [G, all,  all,  own,   own,  own,   own,  own,   own,  own,  _],
  'break-management':      [G, all,  allV, teamV, own,  teamV, team, team,  pool, own,  _],
  shifts:                  [G, all,  all,  own,   own,  own,   own,  own,   own,  own,  _],
  biometric:               [G, all,  _,    _,     _,    _,     _,    _,     _,    _,    _],
  leave:                   [G, all,  all,  own,   own,  own,   own,  own,   own,  own,  _],
  holidays:                [G, all,  allV, allV,  allV, allV,  allV, allV,  allV, allV, _],
  payroll:                 [G, all,  _,    own,   own,  own,   own,  own,   own,  own,  _],
  performance:             [G, all,  all,  team,  own,  team,  team, team,  pool, own,  _],

  territories:             [G, _,    _,    dept,  _,    _,     team, _,     _,    _,    _],
  leads:                   [G, _,    _,    dept,  _,    _,     team, _,     pool, own,  _],
  callbacks:               [G, _,    _,    dept,  _,    _,     team, _,     pool, own,  _],
  handovers:               [G, _,    _,    dept,  _,    _,     team, _,     pool, own,  _],
  deals:                   [G, _,    _,    dept,  parV, _,     team, _,     pool, own,  _],
  approvals:               [G, _,    _,    dept,  _,    _,     team, _,     pool, par,  _],

  handoff:                 [G, _,    _,    par,   par,  par,   _,    _,     _,    _,    _],
  projects:                [G, _,    _,    _,     own,  dept,  _,    team,  _,    own,  A],
  tasks:                   [G, _,    _,    _,     own,  dept,  team, team,  pool, own,  _],
  'resource-planning':     [G, _,    _,    _,     ownV, dept,  team, team,  _,    _,    _],
  delivery:                [G, _,    _,    _,     par,  par,   _,    teamV, _,    _,    A],

  clients:                 [G, _,    _,    dept,  own,  deptV, team, _,     pool, own,  A],
  'post-closure':          [G, _,    _,    dept,  own,  _,     team, _,     pool, own,  _],
  'client-portal':         [G, _,    _,    dept,  own,  _,     _,    _,     _,    _,    A],

  'billing-terms':         [G, _,    _,    _,     _,    _,     _,    _,     _,    _,    _],
  invoicing:               [G, _,    _,    _,     ownV, _,     _,    _,     _,    _,    A],
  payments:                [G, _,    _,    _,     ownV, _,     _,    _,     _,    _,    A],
  receivables:             [G, _,    _,    _,     ownV, _,     _,    _,     _,    _,    A],
  payables:                [G, _,    _,    _,     _,    _,     _,    _,     _,    own,  _],
  accounting:              [G, _,    _,    _,     _,    _,     _,    _,     _,    _,    _],

  chat:                    [G, dept, dept, dept,  dept, dept,  dept, dept,  dept, dept, _],
  'project-communication': [G, _,    _,    _,     own,  dept,  _,    team,  _,    _,    A],
  documents:               [G, all,  all,  dept,  own,  dept,  team, team,  pool, own,  A],
  reporting:               [G, all,  allV, dept,  own,  dept,  team, team,  pool, own,  A],
  notifications:           [G, own,  own,  own,   own,  own,   own,  own,   own,  own,  A],
  workspace:               [G, own,  own,  own,   own,  own,   own,  own,   own,  own,  _],
};

/**
 * §7.3 carve-outs.
 *
 * MX-1: "Every carve-out is DECLARED DATA, not a condition in the generator.
 * A reader can list every exception in one place."
 *
 * Keyed by matrix position; each value lists actions the module expansion must
 * NOT emit for that position, with the governing rule.
 */
export const CARVE_OUTS: Readonly<Partial<Record<MatrixPosition, readonly string[]>>> = {
  // PA-6 — "Sub-team managers judge the work. Assigning a task and marking it
  // Done are different acts." A naïve expansion of `tasks` = own would grant it.
  'project-manager': ['tasks:review', 'org:view-policies'],

  // OR-13 — branch heads hold `org:view-structure` and `org:view-people`
  // scoped to their department, plus structure-only visibility elsewhere. They
  // do NOT hold `org:view-policies`: "the access model is visible only to Super
  // Admin and to access:view holders."
  //
  // Without this, `organization` = dept* would expand across all three read
  // capabilities and hand every branch head the permission model.
  'sales-head': ['org:view-policies'],
  'dev-dept-head': ['org:view-policies'],
  hr: ['org:view-policies'],
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
