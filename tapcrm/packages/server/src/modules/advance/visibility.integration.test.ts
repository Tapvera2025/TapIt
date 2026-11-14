import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Principal } from '@tapcrm/contracts';
import { authorize } from '@tapcrm/authz';
import { installAuthz } from '../../platform/authz-adapter.js';
import { createRequestContext, type RequestContext } from '../../platform/dal/context.js';
import { platformDb } from '../../platform/dal/db.js';
import { closePools } from '../../platform/dal/pool.js';
import { sql } from '../../platform/dal/sql.js';
import { registerAdvancePolicies } from './policy.js';
import { listAdvances, listDeductions } from './service.js';
import { listAdvanceSchema, listDeductionSchema } from './validators.js';

/**
 * The organization advances list (GET /api/advances) and the deduction lists
 * show only the advances the caller's policy reaches. Migration 0071 gave
 * every position `advance:view` at `own` scope, and the list used to ignore
 * the scope, so every employee saw every advance and its reason.
 *
 * Opt-in like the other integration suites (TAPCRM_INTEGRATION_DB=1 …).
 */
const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
const seed = <T>(reason: string, fragment: ReturnType<typeof sql>) =>
  platformDb.query<T>('seed', reason, fragment);

describe.skipIf(!enabled)('advance list visibility (PostgreSQL)', () => {
  let orgId = '';
  const dept: Record<'a' | 'b', string> = { a: '', b: '' };
  const pos: Record<'staff' | 'hod' | 'hr', string> = { staff: '', hod: '', hr: '' };
  const user: Record<'alice' | 'bob' | 'carol' | 'hod' | 'hr', { id: string; dept: string; pos: string }> = {
    alice: { id: '', dept: '', pos: '' },
    bob: { id: '', dept: '', pos: '' },
    carol: { id: '', dept: '', pos: '' },
    hod: { id: '', dept: '', pos: '' },
    hr: { id: '', dept: '', pos: '' },
  };

  function as(name: keyof typeof user): RequestContext {
    const principal: Principal = {
      id: user[name].id, organizationId: orgId, accountType: 'employee', sessionVersion: 1,
      positionId: user[name].pos, departmentId: user[name].dept, teamId: null, reportsTo: null, organizationalLevel: 10,
    };
    return createRequestContext({ organizationId: orgId, principal, requestId: `advance-visibility-${name}` });
  }

  const names = (rows: readonly { employeeName?: string | null }[]) => rows.map((row) => row.employeeName).sort();

  beforeAll(async () => {
    installAuthz();
    registerAdvancePolicies();
    orgId = (await seed<{ id: string }>('org', sql`
      INSERT INTO organization (code, name) VALUES ('AV' || replace(gen_random_uuid()::text, '-', ''), 'Advance visibility') RETURNING id`))[0]!.id;
    await seed('enable advance', sql`
      INSERT INTO organization_module (organization_id, module_id, status, enabled_at)
      SELECT ${orgId}, m.id, 'enabled', now() FROM module m WHERE m.key = 'advance' ON CONFLICT DO NOTHING`);
    for (const key of ['a', 'b'] as const) {
      dept[key] = (await seed<{ id: string }>(`dept ${key}`, sql`
        INSERT INTO department (organization_id, code, name, kind) VALUES (${orgId}, ${`D${key.toUpperCase()}`}, ${`Dept ${key}`}, 'support') RETURNING id`))[0]!.id;
    }
    for (const [key, scope] of [['staff', 'own'], ['hod', 'department'], ['hr', 'all-people']] as const) {
      pos[key] = (await seed<{ id: string }>(`position ${key}`, sql`
        INSERT INTO position (organization_id, department_id, code, name, organizational_level)
        VALUES (${orgId}, ${dept.a}, ${key.toUpperCase()}, ${key}, 10) RETURNING id`))[0]!.id;
      await seed(`policy ${key}`, sql`
        INSERT INTO position_policy (organization_id, position_id, action, allowed, scope)
        VALUES (${orgId}, ${pos[key]}, 'advance:view', true, ${scope})`);
    }
    await seed('hr export', sql`
      INSERT INTO position_policy (organization_id, position_id, action, allowed, scope)
      VALUES (${orgId}, ${pos.hr}, 'advance:export', true, 'all-people')`);

    const people = [
      ['alice', dept.a, pos.staff], ['bob', dept.a, pos.staff], ['carol', dept.b, pos.staff],
      ['hod', dept.a, pos.hod], ['hr', dept.a, pos.hr],
    ] as const;
    for (const [name, departmentId, positionId] of people) {
      const id = (await seed<{ id: string }>(`user ${name}`, sql`
        INSERT INTO app_user (organization_id, employee_id, email, full_name, account_type, department_id, position_id)
        VALUES (${orgId}, ${name.toUpperCase()}, ${`${name}-${randomUUID()}@advance-visibility.invalid`}, ${name}, 'employee', ${departmentId}, ${positionId})
        RETURNING id`))[0]!.id;
      user[name] = { id, dept: departmentId, pos: positionId };
    }
    for (const name of ['alice', 'carol'] as const) {
      const advanceId = (await seed<{ id: string }>(`advance ${name}`, sql`
        INSERT INTO employee_advance (organization_id, employee_id, requested_amount_paise, approved_amount_paise,
          currency, requested_for_period, reason, status, source, approved_at, approved_by, created_by)
        VALUES (${orgId}, ${user[name].id}, 500000, 500000, 'INR', '2026-11-01', ${`${name}'s private reason`},
          'approved', 'manual', now(), ${user.hr.id}, ${user.hr.id}) RETURNING id`))[0]!.id;
      await seed(`deduction ${name}`, sql`
        INSERT INTO employee_advance_deduction (organization_id, advance_id, employee_id, payroll_period, scheduled_amount_paise)
        VALUES (${orgId}, ${advanceId}, ${user[name].id}, '2026-12-01', 500000)`);
    }
  });

  afterAll(async () => closePools());

  it('an ordinary employee passes the route check but sees only their own advance', async () => {
    await authorize(as('bob'), 'advance:view'); // what GET /api/advances checks
    expect((await listAdvances(as('bob'), listAdvanceSchema.parse({}))).total).toBe(0);

    const alice = await listAdvances(as('alice'), listAdvanceSchema.parse({}));
    expect(alice.total).toBe(1);
    expect(names(alice.rows)).toEqual(['alice']);
  });

  it('department scope sees its own department only; all-people sees everyone', async () => {
    expect(names((await listAdvances(as('hod'), listAdvanceSchema.parse({}))).rows)).toEqual(['alice']);
    expect(names((await listAdvances(as('hr'), listAdvanceSchema.parse({}))).rows)).toEqual(['alice', 'carol']);
  });

  it('the scope still combines with the list filters (status, search)', async () => {
    expect((await listAdvances(as('hr'), listAdvanceSchema.parse({ search: 'carol' }))).total).toBe(1);
    expect((await listAdvances(as('hod'), listAdvanceSchema.parse({ search: 'carol' }))).total).toBe(0);
    expect((await listAdvances(as('hr'), listAdvanceSchema.parse({ status: 'pending' }))).total).toBe(0);
  });

  it('deduction lists follow the same scope; export needs the export action', async () => {
    expect((await listDeductions(as('bob'), listDeductionSchema.parse({}))).total).toBe(0);
    expect(names((await listDeductions(as('alice'), listDeductionSchema.parse({}))).rows)).toEqual(['alice']);
    expect(names((await listDeductions(as('hod'), listDeductionSchema.parse({}))).rows)).toEqual(['alice']);
    expect(names((await listDeductions(as('hr'), listDeductionSchema.parse({}))).rows)).toEqual(['alice', 'carol']);
    expect((await listDeductions(as('hr'), listDeductionSchema.parse({}), 'advance:export')).total).toBe(2);
    expect((await listDeductions(as('hod'), listDeductionSchema.parse({}), 'advance:export')).total).toBe(0);
  });
});
