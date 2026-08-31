#!/usr/bin/env tsx
/**
 * Seeding — TECH.md §17.
 *
 * SD-1: seeds are IDEMPOTENT. Re-running changes nothing.
 * SD-4: step 5 (position_policy) is GENERATED, never hand-written, and is
 *       diffed against the matrix in CI (MX-3).
 *
 * Seed order from §17.1 is mandatory because of dependencies. This implements
 * the P0 subset; the steps belonging to later phases are listed and skipped
 * explicitly rather than silently omitted, so the gap is visible:
 *
 *    1. organization              ✓
 *    2. ledger_account            ✗ P6 — chart of accounts (LG-2)
 *    3. department                ✓
 *    4. position                  ✓
 *    5. position_policy           ✓ generated from §6 via §7
 *    6. registry_action           ✓ projection of the registry (RG-I3)
 *    7. designation               ✓
 *    8. leave_type                ✗ P1 — blocked on BD-5 (LV-G)
 *    9. shift                     ✗ P1
 *   10. holiday                   ✗ P1
 *   11. tax_rate                  ✗ BLOCKED on BD-27 (SD-2)
 *   12. invoice_series            ✗ BLOCKED on BD-27 (SD-2)
 *   13. accounting_period         ✗ P6
 *   14. super-admin account       ✓
 *
 * SD-2: steps 11 and 12 "produce a VISIBLE GO-LIVE BLOCKER rather than a
 * plausible default. Guessing a GST rate is a statutory problem."
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import argon2 from 'argon2';
import { PERMISSION_MATRIX, MATRIX_POSITIONS, CARVE_OUTS, type Cell } from './matrix.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

interface RegistryAction {
  action: string;
  module: string;
  resource: string | null;
  domain: string;
  sensitive: boolean;
  approvalBearing: boolean;
  initiatorField: string | null;
  grantPolicy: {
    positionGrantable: boolean;
    delegationAllowed: boolean;
    superAdminOnly: boolean;
  };
  description: string;
}

const seed = JSON.parse(
  readFileSync(resolve(ROOT, 'seeds/registry.seed.json'), 'utf8'),
) as { actions: RegistryAction[] };

const ORG_CODE = process.env['SEED_ORG_CODE'] ?? 'tapvera';
const ORG_NAME = process.env['SEED_ORG_NAME'] ?? 'Tapvera Technologies';

/* ------------------------------------------------------------------ *
 * §3.2 departments, §3.3 the sixteen seeded positions
 * ------------------------------------------------------------------ */

const DEPARTMENTS = [
  { code: 'hr', name: 'Human Resources', kind: 'support', status: 'active' },
  { code: 'sales', name: 'Sales', kind: 'delivery', status: 'active' },
  { code: 'projects', name: 'Project Delivery', kind: 'delivery', status: 'active' },
  { code: 'development', name: 'Development', kind: 'delivery', status: 'active' },
  // D-6: Finance ships INACTIVE. The department exists in the ladder so that
  // staffing finance later is an activation, not a schema change.
  { code: 'finance', name: 'Finance', kind: 'support', status: 'inactive' },
] as const;

const TEAMS = [
  {
    department: 'development',
    kind: 'dev-subteam',
    name: 'Developer Team',
    leadPosition: 'developer-team-manager',
  },
  {
    department: 'development',
    kind: 'dev-subteam',
    name: 'Digital & Marketing',
    leadPosition: 'digital-marketing-manager',
  },
  {
    department: 'development',
    kind: 'dev-subteam',
    name: 'Content Team',
    leadPosition: 'content-team-manager',
  },
] as const;

interface SeedPosition {
  code: string;
  name: string;
  department: string;
  level: number;
  parent: string | null;
  status: 'active' | 'inactive';
  /** Which §6 matrix column supplies this position's defaults. */
  matrixColumn: (typeof MATRIX_POSITIONS)[number] | null;
}

const POSITIONS: readonly SeedPosition[] = [
  // Human Resources — deliberately two levels (§3.3).
  { code: 'hr', name: 'HR', department: 'hr', level: 90, parent: null, status: 'active', matrixColumn: 'hr' },
  { code: 'hr-executive', name: 'HR Executive / Assistant', department: 'hr', level: 40, parent: 'hr', status: 'active', matrixColumn: 'hr-executive' },

  // Sales
  { code: 'sales-head', name: 'Sales Department Head', department: 'sales', level: 90, parent: null, status: 'active', matrixColumn: 'sales-head' },
  { code: 'sales-team-lead', name: 'Sales Team Lead', department: 'sales', level: 70, parent: 'sales-head', status: 'active', matrixColumn: 'sales-team-lead' },
  { code: 'sales-supervisor', name: 'Sales Supervisor', department: 'sales', level: 50, parent: 'sales-team-lead', status: 'active', matrixColumn: 'sales-supervisor' },
  { code: 'sales-agent', name: 'Sales Agent', department: 'sales', level: 20, parent: 'sales-supervisor', status: 'active', matrixColumn: 'base-employee' },

  // Project Delivery — D-5: no head; every PM reports to Super Admin.
  { code: 'project-manager', name: 'Project Manager', department: 'projects', level: 80, parent: null, status: 'active', matrixColumn: 'project-manager' },

  // Development
  { code: 'dev-dept-head', name: 'Development Department Head', department: 'development', level: 90, parent: null, status: 'active', matrixColumn: 'dev-dept-head' },
  { code: 'developer-team-manager', name: 'Developer Team Manager', department: 'development', level: 65, parent: 'dev-dept-head', status: 'active', matrixColumn: 'sub-team-manager' },
  { code: 'digital-marketing-manager', name: 'Digital & Marketing Manager', department: 'development', level: 65, parent: 'dev-dept-head', status: 'active', matrixColumn: 'sub-team-manager' },
  { code: 'content-team-manager', name: 'Content Team Manager', department: 'development', level: 65, parent: 'dev-dept-head', status: 'active', matrixColumn: 'sub-team-manager' },
  { code: 'developer', name: 'Developer', department: 'development', level: 25, parent: 'developer-team-manager', status: 'active', matrixColumn: 'base-employee' },
  { code: 'marketing-executive', name: 'Marketing Executive', department: 'development', level: 25, parent: 'digital-marketing-manager', status: 'active', matrixColumn: 'base-employee' },
  { code: 'content-writer', name: 'Content Writer', department: 'development', level: 25, parent: 'content-team-manager', status: 'active', matrixColumn: 'base-employee' },

  // Finance — seeded but UNSTAFFED (D-6). §6 omits their columns; the matrix
  // note gives their policy set, which lands with P6.
  { code: 'finance-manager', name: 'Finance Manager', department: 'finance', level: 90, parent: null, status: 'inactive', matrixColumn: null },
  { code: 'accountant', name: 'Accountant', department: 'finance', level: 40, parent: 'finance-manager', status: 'inactive', matrixColumn: null },
];

const DESIGNATIONS = [
  { name: 'Developer', specializations: ['Frontend', 'Backend', 'Full-stack', 'QA / Tester'] },
  { name: 'Marketing Executive', specializations: ['SEO', 'Ads / PPC', 'Social Media', 'Analytics'] },
  { name: 'Content Writer', specializations: ['Web Copy', 'Blog', 'Technical', 'Ad Copy'] },
] as const;

/* ------------------------------------------------------------------ *
 * §7 — matrix cell → position_policy rows
 * ------------------------------------------------------------------ */

interface EmittedPolicy {
  action: string;
  scope: string;
}

const actionsByModule = new Map<string, RegistryAction[]>();
for (const action of seed.actions) {
  actionsByModule.set(action.module, [...(actionsByModule.get(action.module) ?? []), action]);
}

/**
 * §7.1 / §7.2 — expands one cell.
 *
 * The `*` modifier is precise: "For the module's `:view` action ONLY. No rows
 * for any write action." §7.2 — "Read-only is the ABSENCE of write policy rows,
 * not a flag on a row. This is why it cannot be bypassed by a handler that
 * forgets a check: THERE IS NO CAPABILITY TO CHECK."
 */
function expandCell(module: string, cell: Cell, position: string): EmittedPolicy[] {
  // glob: no rows. Held by accountType, derived, never stored.
  // acct: no rows. Client isolation is A2, before policy resolution.
  // —   : no rows. Absent means denied.
  if (cell === 'glob' || cell === 'acct' || cell === '—') return [];

  const readOnly = cell.endsWith('*');
  const scope = readOnly ? cell.slice(0, -1) : cell;
  const moduleActions = actionsByModule.get(module) ?? [];
  const excluded = new Set(CARVE_OUTS[position as keyof typeof CARVE_OUTS] ?? []);

  const emitted: EmittedPolicy[] = [];

  for (const definition of moduleActions) {
    // §7.3 — a module cell NEVER includes a non-position-grantable action.
    // Derived from the registry flag rather than a name list, so a future
    // non-grantable action is covered without editing this function.
    if (!definition.grantPolicy.positionGrantable) continue;

    // §7.3 — nor a superAdminOnly action. Those are emitted separately, with
    // an explicit comment, "so a reviewer can see every Super-Admin-granted
    // capability in one place."
    if (definition.grantPolicy.superAdminOnly) continue;

    // MX-1 — declared carve-outs, e.g. PA-6 keeping tasks:review from a PM.
    if (excluded.has(definition.action)) continue;

    if (readOnly) {
      // §7.2 says "the module's `:view` action only". Taken literally that
      // finds nothing for `organization`, whose read capability is THREE
      // actions — §6.1: "organization reads view for three positions, but that
      // is three capabilities, not one" (OR-12). The same applies to
      // `attendance:view-live` and `performance:view-aggregates`.
      //
      // So read-only matches any action whose verb begins `view`, which is the
      // honest generalisation of "the module's read action".
      const verb = definition.action.split(':')[1] ?? '';
      if (!verb.startsWith('view')) continue;
    }

    emitted.push({ action: definition.action, scope });
  }

  return emitted;
}

/* ------------------------------------------------------------------ *
 * Run
 * ------------------------------------------------------------------ */

async function main(): Promise<void> {
  const url = process.env['MIGRATION_DATABASE_URL'] ?? process.env['DATABASE_URL'];
  if (!url) throw new Error('MIGRATION_DATABASE_URL is not set. Seeds run as the admin role (PG-3).');

  const client = new pg.Client({ connectionString: url });
  await client.connect();

  try {
    await client.query('BEGIN');

    /* -- 1. organization ------------------------------------------- */
    const org = await client.query<{ id: string }>(
      `INSERT INTO organization (code, name)
       VALUES ($1, $2)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [ORG_CODE, ORG_NAME],
    );
    const organizationId = org.rows[0]!.id;

    // Tenant context for everything below (TN-6). Transaction-local.
    await client.query(`SELECT set_config('app.organization_id', $1, true)`, [
      organizationId,
    ]);

    /* -- 6. registry_action (global projection, RG-I3) ------------- */
    // "regenerated on deploy; it is a PROJECTION, NEVER EDITED; a row absent
    //  from the generated set is REMOVED."
    for (const a of seed.actions) {
      await client.query(
        `INSERT INTO registry_action
           (action, module, resource, domain, sensitive, approval_bearing, initiator_field,
            position_grantable, delegation_allowed, super_admin_only, description)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (action) DO UPDATE SET
           module = EXCLUDED.module, resource = EXCLUDED.resource, domain = EXCLUDED.domain,
           sensitive = EXCLUDED.sensitive, approval_bearing = EXCLUDED.approval_bearing,
           initiator_field = EXCLUDED.initiator_field,
           position_grantable = EXCLUDED.position_grantable,
           delegation_allowed = EXCLUDED.delegation_allowed,
           super_admin_only = EXCLUDED.super_admin_only,
           description = EXCLUDED.description`,
        [
          a.action,
          a.module,
          a.resource,
          a.domain,
          a.sensitive,
          a.approvalBearing,
          a.initiatorField,
          a.grantPolicy.positionGrantable,
          a.grantPolicy.delegationAllowed,
          a.grantPolicy.superAdminOnly,
          a.description,
        ],
      );
    }
    await client.query(`DELETE FROM registry_action WHERE action <> ALL($1::text[])`, [
      seed.actions.map((a) => a.action),
    ]);

    /* -- 3. department --------------------------------------------- */
    const departmentIds = new Map<string, string>();
    for (const d of DEPARTMENTS) {
      const row = await client.query<{ id: string }>(
        `INSERT INTO department (organization_id, code, name, kind, status)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (organization_id, code)
         DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind, status = EXCLUDED.status
         RETURNING id`,
        [organizationId, d.code, d.name, d.kind, d.status],
      );
      departmentIds.set(d.code, row.rows[0]!.id);
    }

    /* -- 4. position (parents second, so the FK resolves) ---------- */
    const positionIds = new Map<string, string>();
    for (const p of POSITIONS) {
      const row = await client.query<{ id: string }>(
        `INSERT INTO position
           (organization_id, department_id, code, name, organizational_level, is_seeded, status)
         VALUES ($1,$2,$3,$4,$5,true,$6)
         ON CONFLICT (organization_id, code)
         DO UPDATE SET name = EXCLUDED.name,
                       organizational_level = EXCLUDED.organizational_level,
                       status = EXCLUDED.status
         RETURNING id`,
        [
          organizationId,
          departmentIds.get(p.department),
          p.code,
          p.name,
          p.level,
          p.status,
        ],
      );
      positionIds.set(p.code, row.rows[0]!.id);
    }
    for (const p of POSITIONS) {
      if (p.parent === null) continue;
      await client.query(
        `UPDATE position SET parent_position_id = $1 WHERE organization_id = $2 AND code = $3`,
        [positionIds.get(p.parent), organizationId, p.code],
      );
    }
    /* -- development teams ------------------------------------------- */

    for (const team of TEAMS) {
      const departmentId = departmentIds.get(team.department);

      if (!departmentId) {
        throw new Error(`Missing department for seeded team: ${team.name}`);
      }

      await client.query(
        `INSERT INTO team
       (
         organization_id,
         department_id,
         kind,
         name,
         lead_user_id,
         parent_team_id,
         shared_visibility
       )
     VALUES
       ($1, $2, $3, $4, NULL, NULL, false)
     ON CONFLICT DO NOTHING`,
        [organizationId, departmentId, team.kind, team.name],
      );
    }

    /* -- 7. designation -------------------------------------------- */
    for (const d of DESIGNATIONS) {
      await client.query(
        `INSERT INTO designation (organization_id, name, specializations)
         VALUES ($1,$2,$3)
         ON CONFLICT DO NOTHING`,
        [organizationId, d.name, d.specializations],
      );
    }

    /* -- 5. position_policy — GENERATED (SD-4) --------------------- */
    let emittedCount = 0;
    const emptyCells: string[] = [];
    const modulesWithoutActions = new Set<string>();

    for (const p of POSITIONS) {
      if (p.matrixColumn === null) continue;
      const columnIndex = MATRIX_POSITIONS.indexOf(p.matrixColumn);
      const positionId = positionIds.get(p.code)!;

      // Regenerate from scratch: the matrix is the source, so a policy no
      // longer produced by it must disappear rather than linger.
      await client.query(
        `DELETE FROM position_policy WHERE organization_id = $1 AND position_id = $2`,
        [organizationId, positionId],
      );

      for (const [module, cells] of Object.entries(PERMISSION_MATRIX)) {
        const cell = cells[columnIndex];
        if (cell === undefined) continue;

        const policies = expandCell(module, cell, p.matrixColumn);

        // MX-2 — "a CI check asserts every matrix cell produces at least one
        // policy row unless the cell is —, glob or acct. A cell that silently
        // produces nothing is a TYPO."
        //
        // Two different causes, and conflating them would hide the interesting
        // one. A module the registry has no actions for is a CI-8 gap BETWEEN
        // the two source documents; a module that has actions but still emits
        // nothing is a typo in this file.
        if (policies.length === 0 && !['—', 'glob', 'acct'].includes(cell)) {
          const moduleHasActions = (actionsByModule.get(module) ?? []).length > 0;
          if (moduleHasActions) {
            emptyCells.push(`${p.code} × ${module} = ${cell}`);
          } else {
            modulesWithoutActions.add(module);
          }
        }

        for (const policy of policies) {
          await client.query(
            `INSERT INTO position_policy (organization_id, position_id, action, allowed, scope)
             VALUES ($1,$2,$3,true,$4)
             ON CONFLICT (organization_id, position_id, action)
             DO UPDATE SET scope = EXCLUDED.scope, allowed = true`,
            [organizationId, positionId, policy.action, policy.scope],
          );
          emittedCount += 1;
        }
      }
    }

    if (emptyCells.length > 0) {
      throw new Error(
        `MX-2: ${emptyCells.length} matrix cell(s) produced no policy rows. ` +
          `A cell that silently produces nothing is a typo:\n  ${emptyCells.join('\n  ')}`,
      );
    }

    /* -- 14. super-admin account ----------------------------------- */
    // §2.1 — Super Admin is NOT a Position: no position, no department, no
    // place in the reporting chain.
    const email = process.env['SEED_SUPERADMIN_EMAIL'] ?? 'admin@tapvera.io';
    const password = process.env['SEED_SUPERADMIN_PASSWORD'] ?? 'Admin@Tapvera2026!';
    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    await client.query(
      `INSERT INTO app_user (organization_id, account_type, email, password_hash, full_name, status, mfa_required, email_verified_at)
       VALUES ($1,'super-admin',$2,$3,$4,'active',false, NOW())
       -- The unique index is PARTIAL (WHERE email IS NOT NULL), so the
       -- predicate must be repeated here for PostgreSQL to infer it.
       ON CONFLICT (organization_id, account_type, email) WHERE email IS NOT NULL
       DO UPDATE SET password_hash = EXCLUDED.password_hash, mfa_required = EXCLUDED.mfa_required, email_verified_at = EXCLUDED.email_verified_at`,
      [organizationId, email, passwordHash, 'Super Admin'],
    );

    await client.query('COMMIT');

    console.log(`✓ Seeded organization "${ORG_NAME}" (code: ${ORG_CODE})`);
    console.log(`  ${seed.actions.length} registry actions projected`);
    console.log(`  ${DEPARTMENTS.length} departments · ${POSITIONS.length} positions`);
    console.log(`  ${emittedCount} position_policy rows generated from the §6 matrix`);
    console.log(`  super-admin: ${email} / ${password}`);

    if (modulesWithoutActions.size > 0) {
      console.log(
        `\n⚠ CI-8 — ${modulesWithoutActions.size} module(s) carry a PRD §6 permission-matrix\n` +
          '  cell but have NO actions in AUTHORIZATION.md §6.4, so no policy can be\n' +
          '  emitted for them. This is a gap between the two source documents, not a\n' +
          '  seed defect:\n    ' +
          [...modulesWithoutActions].sort().join('\n    ') +
          '\n  Resolve by adding the actions to §6.4, or by removing the §6 rows.',
      );
    }

    console.log(
      '\n⚠ GO-LIVE BLOCKERS (SD-2 — deliberately not defaulted):\n' +
        '  BD-27  tax_rate and invoice_series unseeded. Guessing a GST rate is a\n' +
        '         statutory problem, so no plausible default is written.\n' +
        '  BD-5   leave_type unseeded (LV-G: zero entitlement, enforcement off).\n' +
        '  BD-2   organization structure roster not loaded (§17.2).\n' +
        '  BD-28  financial cutover / opening balances not loaded (§17.3).',
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
