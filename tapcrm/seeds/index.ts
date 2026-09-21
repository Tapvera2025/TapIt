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
import type { SqlFragment } from '@tapcrm/authz';
import { PERMISSION_MATRIX, MATRIX_POSITIONS, type Cell } from './matrix.js';
import { bootstrapOrganization } from '../packages/server/src/platform/organizations/bootstrap.js';
import {
  expandPermissionCell,
  type RegistryActionDefinition,
} from '../packages/server/src/platform/organizations/policy-matrix.js';
import { ORGANIZATION_TEMPLATE } from '../packages/server/src/platform/organizations/template.js';
import { camelizeRows } from '../packages/server/src/platform/dal/mapping.js';
import type { Tx } from '../packages/server/src/platform/dal/db.js';

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
 * §3.2 departments, §3.3 seeded positions, and starter designations.
 * The reusable template is shared with company provisioning.
 * ------------------------------------------------------------------ */

const DEPARTMENTS = ORGANIZATION_TEMPLATE.departments;
const POSITIONS = ORGANIZATION_TEMPLATE.positions;

function txAdapter(client: pg.Client): Tx {
  return {
    async query<T>(fragment: SqlFragment) {
      const result = await client.query(fragment.sql, [...fragment.parameters]);
      return camelizeRows<T>(result.rows);
    },
    async one<T>(fragment: SqlFragment) {
      const rows = await this.query<T>(fragment);
      if (rows.length !== 1)
        throw new Error(`Expected exactly one row, got ${rows.length}`);
      return rows[0]!;
    },
    async maybeOne<T>(fragment: SqlFragment) {
      const rows = await this.query<T>(fragment);
      if (rows.length > 1)
        throw new Error(`Expected at most one row, got ${rows.length}`);
      return rows[0] ?? null;
    },
  };
}

/* ------------------------------------------------------------------ *
 * §7 — matrix cell → position_policy rows
 * ------------------------------------------------------------------ */

const sharedActionsByModule = new Map<string, RegistryActionDefinition[]>();
for (const action of seed.actions) {
  const definition: RegistryActionDefinition = {
    action: action.action,
    module: action.module,
    positionGrantable: action.grantPolicy.positionGrantable,
    superAdminOnly: action.grantPolicy.superAdminOnly,
  };
  sharedActionsByModule.set(action.module, [
    ...(sharedActionsByModule.get(action.module) ?? []),
    definition,
  ]);
}

/**
 * §7.1 / §7.2 — expands one cell.
 *
 * The `*` modifier is precise: "For the module's `:view` action ONLY. No rows
 * for any write action." §7.2 — "Read-only is the ABSENCE of write policy rows,
 * not a flag on a row. This is why it cannot be bypassed by a handler that
 * forgets a check: THERE IS NO CAPABILITY TO CHECK."
 */
function expandCell(module: string, cell: Cell, position: string) {
  return expandPermissionCell(module, cell, position, sharedActionsByModule);
}

/* ------------------------------------------------------------------ *
 * Run
 * ------------------------------------------------------------------ */

async function main(): Promise<void> {
  const url = process.env['MIGRATION_DATABASE_URL'] ?? process.env['DATABASE_URL'];
  if (!url)
    throw new Error(
      'MIGRATION_DATABASE_URL is not set. Seeds run as the admin role (PG-3).',
    );

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

    /* -- platform module entitlements for the seeded tenant -------- */
    await client.query(
      `INSERT INTO organization_module (organization_id, module_id, status, enabled_at)
       SELECT $1, id, 'enabled', now() FROM module WHERE is_core = true
       ON CONFLICT (organization_id, module_id) DO UPDATE SET status = 'enabled', enabled_at = COALESCE(organization_module.enabled_at, now())`,
      [organizationId],
    );

    /* -- 3–4 and 7. organization starter structure ---------------- */
    await bootstrapOrganization(txAdapter(client), organizationId, [], {
      includeAll: true,
    });
    const positionIds = new Map<string, string>(
      (
        await client.query<{ code: string; id: string }>(
          `SELECT code, id FROM position WHERE organization_id = $1`,
          [organizationId],
        )
      ).rows.map((row) => [row.code, row.id]),
    );

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
          const moduleHasActions = (sharedActionsByModule.get(module) ?? []).length > 0;
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
    await client.query(
      `INSERT INTO app_user (organization_id, account_type, email, full_name, status, mfa_required)
       VALUES ($1,'super-admin',$2,$3,'active',true)
       -- ID-1 uses a global partial email index, so the predicate must be
       -- repeated here for PostgreSQL to infer the conflict target.
       ON CONFLICT (email) WHERE email IS NOT NULL
       DO NOTHING`,
      [organizationId, email, 'Super Admin'],
    );

    await client.query('COMMIT');

    console.log(`✓ Seeded organization "${ORG_NAME}"`);
    console.log(`  ${seed.actions.length} registry actions projected`);
    console.log(`  ${DEPARTMENTS.length} departments · ${POSITIONS.length} positions`);
    console.log(`  ${emittedCount} position_policy rows generated from the §6 matrix`);
    console.log(`  super-admin: ${email} (ID-4 requires a high-assurance second factor)`);

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
