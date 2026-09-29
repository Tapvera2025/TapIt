import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Principal } from '@tapcrm/contracts';
import { createRequestContext, type RequestContext } from '../../platform/dal/context.js';
import { platformDb } from '../../platform/dal/db.js';
import { closePools } from '../../platform/dal/pool.js';
import { sql } from '../../platform/dal/sql.js';
import { provisionEmployee, updateEmployee } from './service.js';

/**
 * Joining and leaving dates (migration 0060, §8.6) against real PostgreSQL:
 * stored on the employee, refused when they cross, audited, and announced to
 * attendance through the outbox with the days they may change.
 *
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=… DATABASE_URL=… npx vitest run <file>
 */
const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
const ORG = randomUUID();
const DEPT = randomUUID();
const POS = randomUUID();
const EMPLOYEE = randomUUID();
const ROBOT = randomUUID();

const asOwner = (reason: string, fragment: ReturnType<typeof sql>) =>
  platformDb.query('migration', reason, fragment);

function ctx(): RequestContext {
  const principal: Principal = {
    id: randomUUID(),
    organizationId: ORG,
    accountType: 'super-admin',
    sessionVersion: 1,
  };
  return createRequestContext({
    organizationId: ORG,
    principal,
    requestId: randomUUID(),
  });
}

async function windowOf(userId: string) {
  const [row] = await asOwner(
    'read the window',
    sql`SELECT joined_on::text AS joined_on, left_on::text AS left_on FROM app_user WHERE id = ${userId}`,
  );
  return row;
}

async function announcements() {
  return (await asOwner(
    'read the announcements',
    sql`SELECT payload FROM domain_outbox
        WHERE organization_id = ${ORG} AND event_name = 'employee.employment-changed'
        ORDER BY enqueued_at, id`,
  )) as { payload: unknown }[];
}

describe.skipIf(!enabled)('employment dates (PostgreSQL)', () => {
  beforeAll(async () => {
    await asOwner(
      'organization',
      sql`INSERT INTO organization (id, code, name) VALUES (${ORG}, ${`ED${ORG.slice(0, 6)}`}, 'Employment')`,
    );
    await asOwner(
      'department',
      sql`INSERT INTO department (id, organization_id, code, name, kind)
          VALUES (${DEPT}, ${ORG}, 'OPS', 'Operations', 'operations')`,
    );
    await asOwner(
      'position',
      sql`INSERT INTO position (id, organization_id, department_id, code, name, organizational_level)
          VALUES (${POS}, ${ORG}, ${DEPT}, 'OP', 'Operator', 20)`,
    );
    await asOwner(
      'people',
      sql`INSERT INTO app_user (id, organization_id, account_type, employee_id, email, full_name, position_id, department_id)
          VALUES (${EMPLOYEE}, ${ORG}, 'employee', 'EMP-ED1', ${`e-${EMPLOYEE}@t.io`}, 'Employee', ${POS}, ${DEPT})`,
    );
    await asOwner(
      'a service account',
      sql`INSERT INTO app_user (id, organization_id, account_type, email, full_name)
          VALUES (${ROBOT}, ${ORG}, 'service', ${`robot-${ROBOT}@t.io`}, 'Robot')`,
    );
  });

  afterAll(async () => {
    for (const table of [
      'domain_outbox',
      'audit_outbox',
      'identity_email_directory',
      'app_user',
    ]) {
      await asOwner(
        `clear ${table}`,
        sql`DELETE FROM ${sql.raw(table)} WHERE organization_id = ${ORG}`,
      );
    }
    for (const table of ['position', 'department']) {
      await asOwner(
        `clear ${table}`,
        sql`DELETE FROM ${sql.raw(table)} WHERE organization_id = ${ORG}`,
      );
    }
    await asOwner('clear organization', sql`DELETE FROM organization WHERE id = ${ORG}`);
    await closePools();
  });

  it('a new employee can start with a joining date', async () => {
    const created = await provisionEmployee(ctx(), {
      email: `joiner-${randomUUID()}@t.io`,
      fullName: 'New Joiner',
      password: 'Long-enough-password-123!',
      confirmPassword: 'Long-enough-password-123!',
      departmentId: DEPT,
      positionId: POS,
      joiningDate: '2026-10-05' as never,
    });
    expect(await windowOf(created.employee.id)).toEqual({
      joinedOn: '2026-10-05',
      leftOn: null,
    });
  });

  it('a leaving date is stored, audited, and announced with the days after it', async () => {
    await expect(
      updateEmployee(ctx(), EMPLOYEE, { joiningDate: '2026-01-01' as never }),
    ).resolves.toEqual({ id: EMPLOYEE, joiningDate: '2026-01-01', leavingDate: null });
    await expect(
      updateEmployee(ctx(), EMPLOYEE, { leavingDate: '2026-10-10' as never }),
    ).resolves.toEqual({
      id: EMPLOYEE,
      joiningDate: '2026-01-01',
      leavingDate: '2026-10-10',
    });
    expect(await windowOf(EMPLOYEE)).toEqual({
      joinedOn: '2026-01-01',
      leftOn: '2026-10-10',
    });

    expect((await announcements()).map((row) => row.payload)).toEqual([
      { userId: EMPLOYEE, from: '1900-01-01', to: '2025-12-31' },
      { userId: EMPLOYEE, from: '2026-10-11', to: null },
    ]);
    const audits = await asOwner(
      'the audit entry',
      sql`SELECT payload->'before' AS before, payload->'after' AS after FROM audit_outbox
          WHERE organization_id = ${ORG} AND payload->>'action' = 'employee.employment_dates_changed'
            AND payload->>'targetId' = ${EMPLOYEE}
          ORDER BY enqueued_at DESC, id DESC LIMIT 1`,
    );
    expect(audits).toEqual([
      {
        before: { joiningDate: '2026-01-01', leavingDate: null },
        after: { joiningDate: '2026-01-01', leavingDate: '2026-10-10' },
      },
    ]);
  });

  it('the same dates again change nothing and announce nothing', async () => {
    const before = (await announcements()).length;
    await updateEmployee(ctx(), EMPLOYEE, { leavingDate: '2026-10-10' as never });
    expect(await announcements()).toHaveLength(before);
  });

  it('refuses a leaving date before the joining date, and a window for a non-employee', async () => {
    await expect(
      updateEmployee(ctx(), EMPLOYEE, { leavingDate: '2025-12-31' as never }),
    ).rejects.toMatchObject({ status: 422, code: 'IDENTITY_EMPLOYMENT_DATES_INVALID' });
    await expect(
      updateEmployee(ctx(), ROBOT, { joiningDate: '2026-01-01' as never }),
    ).rejects.toMatchObject({ status: 422, code: 'IDENTITY_NOT_AN_EMPLOYEE' });
    // The database says the same, whoever writes.
    await expect(
      asOwner(
        'a crossed window',
        sql`UPDATE app_user SET left_on = '2025-01-01' WHERE id = ${EMPLOYEE}`,
      ),
    ).rejects.toThrow(/app_user_employment_window/);
  });
});
