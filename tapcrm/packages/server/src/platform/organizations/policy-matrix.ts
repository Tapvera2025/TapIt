import type { ModuleName } from '@tapcrm/contracts';
import type { Tx } from '../dal/db.js';
import { sql } from '../dal/sql.js';
import type { OrganizationTemplatePosition } from './template.js';

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
  'base-employee',
  'client',
] as const;

export type MatrixPosition = (typeof MATRIX_POSITIONS)[number];
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

export const PERMISSION_MATRIX: Readonly<Record<ModuleName, readonly Cell[]>> = {
  identity: [G, _, _, _, _, _, _, _, _, _, _],
  organization: [G, deptV, _, deptV, deptV, deptV, _, _, _, _, _],
  // HR may submit position-change requests. `access:view` is carved out below
  // so this does not expose the Super Admin Access Explorer.
  'access-management': [G, dept, _, _, _, _, _, _, _, _, _],
  audit: [G, allV, _, _, _, _, _, _, _, _, _],
  'system-administration': [G, _, _, _, _, _, _, _, _, _, _],
  'employee-directory': [G, all, all, deptV, _, deptV, _, _, _, _, _],
  onboarding: [G, all, all, _, _, _, _, _, _, own, _],
  'live-status': [G, all, all, own, own, own, team, team, pool, own, _],
  attendance: [G, all, all, own, own, own, own, own, own, own, _],
  'break-management': [G, all, allV, teamV, own, teamV, team, team, pool, own, _],
  shifts: [G, all, all, own, own, own, own, own, own, own, _],
  biometric: [G, all, _, _, _, _, _, _, _, _, _],
  leave: [G, all, all, own, own, own, own, own, own, own, _],
  holidays: [G, all, allV, allV, allV, allV, allV, allV, allV, allV, _],
  payroll: [G, all, _, own, own, own, own, own, own, own, _],
  performance: [G, all, all, team, own, team, team, team, pool, own, _],
  territories: [G, _, _, dept, _, _, team, _, _, _, _],
  leads: [G, _, _, dept, _, _, team, _, pool, own, _],
  callbacks: [G, _, _, dept, _, _, team, _, pool, own, _],
  handovers: [G, _, _, dept, _, _, team, _, pool, own, _],
  deals: [G, _, _, dept, parV, _, team, _, pool, own, _],
  approvals: [G, _, _, dept, _, _, team, _, pool, par, _],
  handoff: [G, _, _, par, par, par, _, _, _, _, _],
  projects: [G, _, _, _, own, dept, _, team, _, own, A],
  tasks: [G, _, _, _, own, dept, team, team, pool, own, _],
  'resource-planning': [G, _, _, _, ownV, dept, team, team, _, _, _],
  delivery: [G, _, _, _, par, par, _, teamV, _, _, A],
  clients: [G, _, _, dept, own, deptV, team, _, pool, own, A],
  'post-closure': [G, _, _, dept, own, _, team, _, pool, own, _],
  'client-portal': [G, _, _, dept, own, _, _, _, _, _, A],
  'billing-terms': [G, _, _, _, _, _, _, _, _, _, _],
  invoicing: [G, _, _, _, ownV, _, _, _, _, _, A],
  payments: [G, _, _, _, ownV, _, _, _, _, _, A],
  receivables: [G, _, _, _, ownV, _, _, _, _, _, A],
  payables: [G, _, _, _, _, _, _, _, _, own, _],
  accounting: [G, _, _, _, _, _, _, _, _, _, _],
  chat: [G, dept, dept, dept, dept, dept, dept, dept, dept, dept, _],
  'project-communication': [G, _, _, _, own, dept, _, team, _, _, A],
  documents: [G, all, all, dept, own, dept, team, team, pool, own, A],
  reporting: [G, all, allV, dept, own, dept, team, team, pool, own, A],
  notifications: [G, own, own, own, own, own, own, own, own, own, A],
  workspace: [G, own, own, own, own, own, own, own, own, own, _],
};

export const CARVE_OUTS: Readonly<Partial<Record<MatrixPosition, readonly string[]>>> = {
  // HR can inspect position policies for the employee access preview, but it
  // still does not receive broad Access Management visibility.
  hr: ['access:view'],
  // HR Executive may read people records but does not receive the protected
  // employee-account management capability.
  'hr-executive': ['users:manage'],
  'project-manager': ['tasks:review', 'org:view-policies', 'org:view-people'],
  'sales-head': ['org:view-policies'],
  'dev-dept-head': ['org:view-policies'],
};

export interface RegistryActionDefinition {
  action: string;
  module: string;
  positionGrantable: boolean;
  superAdminOnly: boolean;
}

export interface EmittedPolicy {
  action: string;
  scope: string;
}

export function expandPermissionCell(
  module: string,
  cell: Cell,
  position: string,
  actionsByModule: ReadonlyMap<string, readonly RegistryActionDefinition[]>,
): EmittedPolicy[] {
  if (cell === 'glob' || cell === 'acct' || cell === '—') return [];
  const readOnly = cell.endsWith('*');
  const scope = readOnly ? cell.slice(0, -1) : cell;
  const excluded = new Set(CARVE_OUTS[position as MatrixPosition] ?? []);
  return (actionsByModule.get(module) ?? []).flatMap((definition) => {
    if (!definition.positionGrantable || definition.superAdminOnly) return [];
    if (excluded.has(definition.action)) return [];
    if (readOnly && !(definition.action.split(':')[1] ?? '').startsWith('view'))
      return [];
    return [{ action: definition.action, scope }];
  });
}

/**
 * Add the matrix defaults for one tenant's positions.
 *
 * This intentionally inserts only missing rows. Position policy edits are
 * tenant-owned configuration and bootstrap must never replace them.
 */
export async function provisionDefaultPositionPolicies(
  tx: Tx,
  organizationId: string,
  moduleKeys: readonly string[],
  positions: readonly OrganizationTemplatePosition[],
  positionIds: ReadonlyMap<string, string>,
): Promise<number> {
  const enabledModules = new Set(moduleKeys);
  const actions = await tx.query<RegistryActionDefinition>(sql`
    SELECT action, module, position_grantable AS "positionGrantable",
           super_admin_only AS "superAdminOnly"
    FROM registry_action
    WHERE module = ANY(${[...enabledModules]}::text[])
  `);
  const actionsByModule = new Map<string, RegistryActionDefinition[]>();
  for (const action of actions) {
    const list = actionsByModule.get(action.module) ?? [];
    list.push(action);
    actionsByModule.set(action.module, list);
  }

  let inserted = 0;
  for (const position of positions) {
    if (position.matrixColumn === null) continue;
    const positionId = positionIds.get(position.code);
    if (!positionId) continue;
    const columnIndex = MATRIX_POSITIONS.indexOf(position.matrixColumn);
    for (const [module, cells] of Object.entries(PERMISSION_MATRIX)) {
      if (!enabledModules.has(module)) continue;
      const cell = cells[columnIndex];
      if (cell === undefined) continue;
      for (const policy of expandPermissionCell(
        module,
        cell,
        position.matrixColumn,
        actionsByModule,
      )) {
        const rows = await tx.query<{ inserted: boolean }>(sql`
          INSERT INTO position_policy (organization_id, position_id, action, allowed, scope)
          VALUES (${organizationId}, ${positionId}, ${policy.action}, true, ${policy.scope})
          ON CONFLICT (organization_id, position_id, action) DO NOTHING
          RETURNING true AS inserted
        `);
        inserted += rows.length;
      }
    }
  }
  return inserted;
}
