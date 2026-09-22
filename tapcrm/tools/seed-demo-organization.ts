#!/usr/bin/env tsx
import { loadDotEnv, organizationArgument, demoPassword, DEMO_EMPLOYEES, DEMO_TEAM_PREFIX } from './demo-fixture.js';
import type { Tx } from '../packages/server/src/platform/dal/db.js';

loadDotEnv();
const organizationCode = organizationArgument();
const password = demoPassword();

const [{ platformDb }, { sql }, { bootstrapOrganization }, { hashIdentityPassword }] = await Promise.all([
  import('../packages/server/src/platform/dal/db.js'),
  import('../packages/server/src/platform/dal/sql.js'),
  import('../packages/server/src/platform/organizations/bootstrap.js'),
  import('../packages/server/src/modules/identity/password/service.js'),
]);

const result = await platformDb.transaction('seed', `create development demo fixture for ${organizationCode}`, async (tx) => {
  const organization = await tx.maybeOne<{ id: string; name: string }>(sql`
    SELECT id, name FROM organization WHERE code = ${organizationCode} AND status = 'active'
  `);
  if (!organization) throw new Error(`Active organization "${organizationCode}" was not found`);
  await tx.query(sql`SELECT set_config('app.organization_id', ${organization.id}, true)`);

  const modules = await tx.query<{ key: string }>(sql`
    SELECT m.key FROM organization_module om
    JOIN module m ON m.id = om.module_id
    WHERE om.organization_id = ${organization.id} AND om.status = 'enabled'
  `);
  await bootstrapOrganization(tx, organization.id, modules.map((row) => row.key));

  const positions = new Map<string, { id: string; departmentId: string; status: string }>();
  for (const employee of DEMO_EMPLOYEES) {
    const position = await tx.maybeOne<{ id: string; departmentId: string; status: string }>(sql`
      SELECT id, department_id, status FROM position
      WHERE organization_id = ${organization.id} AND code = ${employee.positionCode}
    `);
    if (!position || position.status !== 'active') throw new Error(`Active position "${employee.positionCode}" is unavailable in ${organizationCode}`);
    positions.set(employee.positionCode, position);
  }

  const demoTeams = new Map<string, string>();
  for (const definition of [
    { seedCode: 'demo-sales-team', name: 'Demo Sales Team', kind: 'sales-team', departmentCode: 'sales', parent: null },
    { seedCode: 'demo-sales-pool', name: 'Demo Sales Pool', kind: 'sales-pool', departmentCode: 'sales', parent: 'demo-sales-team' },
  ] as const) {
    const department = await tx.maybeOne<{ id: string }>(sql`
      SELECT id FROM department WHERE organization_id = ${organization.id} AND code = ${definition.departmentCode} AND status = 'active'
    `);
    if (!department) throw new Error(`Active department "${definition.departmentCode}" is unavailable in ${organizationCode}`);
    const parentId = definition.parent ? demoTeams.get(definition.parent) ?? null : null;
    const seedCode = DEMO_TEAM_PREFIX + definition.seedCode.slice('demo-'.length);
    const existing = await tx.maybeOne<{ id: string }>(sql`
      SELECT id FROM team
      WHERE organization_id = ${organization.id} AND seed_code = ${seedCode}
    `);
    const team = existing
      ? await tx.one<{ id: string }>(sql`
          UPDATE team SET department_id = ${department.id}, kind = ${definition.kind}, name = ${definition.name},
            parent_team_id = ${parentId}, shared_visibility = false, is_seeded = false
          WHERE organization_id = ${organization.id} AND id = ${existing.id}
          RETURNING id
        `)
      : await tx.one<{ id: string }>(sql`
          INSERT INTO team (organization_id, department_id, kind, name, parent_team_id, shared_visibility, is_seeded, seed_code)
          VALUES (${organization.id}, ${department.id}, ${definition.kind}, ${definition.name}, ${parentId}, false, false, ${seedCode})
          RETURNING id
        `);
    demoTeams.set(definition.seedCode, team.id);
  }

  const designations = new Map<string, string>();
  for (const code of ['developer', 'marketing-executive', 'content-writer']) {
    const row = await tx.maybeOne<{ id: string }>(sql`
      SELECT id FROM designation WHERE organization_id = ${organization.id} AND seed_code = ${code} AND status = 'active'
    `);
    if (row) designations.set(code, row.id);
  }
  const passwordHash = await hashIdentityPassword(password);
  const users = new Map<string, string>();
  for (const employee of DEMO_EMPLOYEES) {
    const position = positions.get(employee.positionCode)!;
    const teamId = employee.teamSeedCode ? demoTeams.get(employee.teamSeedCode) ?? await seededTeamId(tx, organization.id, employee.teamSeedCode) : null;
    if (employee.teamSeedCode && !teamId) throw new Error(`Team "${employee.teamSeedCode}" is unavailable in ${organizationCode}`);
    const managerId = employee.reportsToKey ? users.get(employee.reportsToKey) : null;
    if (employee.reportsToKey && !managerId) throw new Error(`Demo manager ${employee.reportsToKey} was not created before ${employee.key}`);
    const existing = await tx.maybeOne<{ id: string }>(sql`
      SELECT id FROM app_user WHERE organization_id = ${organization.id} AND account_type = 'employee' AND email = ${employee.email}
    `);
    const row = existing
      ? await tx.one<{ id: string }>(sql`
          UPDATE app_user SET employee_id = ${employee.employeeId}, full_name = ${employee.fullName}, password_hash = ${passwordHash},
            status = 'active', email_verified_at = now(), must_change_password = false,
            department_id = ${position.departmentId}, position_id = ${position.id}, team_id = ${teamId},
            designation_id = ${employee.designationSeedCode ? designations.get(employee.designationSeedCode) ?? null : null},
            specialization = ${employee.specialization}, reports_to = ${managerId}
          WHERE organization_id = ${organization.id} AND id = ${existing.id}
          RETURNING id
        `)
      : await tx.one<{ id: string }>(sql`
          INSERT INTO app_user (organization_id, account_type, employee_id, email, password_hash, status, email_verified_at,
            department_id, position_id, team_id, designation_id, specialization, reports_to, full_name, must_change_password)
          VALUES (${organization.id}, 'employee', ${employee.employeeId}, ${employee.email}, ${passwordHash}, 'active', now(),
            ${position.departmentId}, ${position.id}, ${teamId}, ${employee.designationSeedCode ? designations.get(employee.designationSeedCode) ?? null : null},
            ${employee.specialization}, ${managerId}, ${employee.fullName}, false)
          RETURNING id
        `);
    users.set(employee.key, row.id);
  }
  await tx.query(sql`
    UPDATE team SET lead_user_id = ${users.get('sales-lead') ?? null}
    WHERE organization_id = ${organization.id} AND seed_code = 'demo-sales-team'
  `);
  await tx.query(sql`
    UPDATE team SET lead_user_id = ${users.get('sales-supervisor') ?? null}
    WHERE organization_id = ${organization.id} AND seed_code = 'demo-sales-pool'
  `);
  return { organizationName: organization.name, employeeCount: DEMO_EMPLOYEES.length };
});

console.log(`✓ Demo fixture ready for ${organizationCode} (${result.organizationName})`);
console.log(`  ${result.employeeCount} employee accounts are available with DEMO_EMPLOYEE_PASSWORD`);

async function seededTeamId(tx: Tx, organizationId: string, seedCode: string): Promise<string | null> {
  const row = await tx.maybeOne<{ id: string }>(sql`
    SELECT id FROM team WHERE organization_id = ${organizationId} AND seed_code = ${seedCode}
  `);
  return row?.id ?? null;
}
