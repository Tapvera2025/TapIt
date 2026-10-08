import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, platformDb } from '../../platform/dal/db.js';
import { closePools } from '../../platform/dal/pool.js';
import { createRequestContext, type RequestContext } from '../../platform/dal/context.js';
import { sql } from '../../platform/dal/sql.js';
import type { Principal } from '@tapcrm/contracts';
import {
  allocateEmployeeId,
  employeeIdExists,
  peekNextEmployeeId,
} from './repository.js';

/**
 * ED-3 — Employee ID allocation and uniqueness.
 *
 * Opt-in, same harness as the override test:
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=... DATABASE_URL=... \
 *   JWT_ACCESS_SECRET=... JWT_REFRESH_SECRET=... REDIS_URL=... npx vitest run <file>
 */
const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
const migrationUrl = process.env['MIGRATION_DATABASE_URL'] ?? '';

const ORG = randomUUID();
const DEPT = randomUUID();
const POS = randomUUID();

const asOwner = (reason: string, fragment: ReturnType<typeof sql>) =>
  platformDb.query('migration', reason, fragment);

function ctx(): RequestContext {
  // A super-admin context is enough to exercise the DAL under tenant RLS.
  const principal: Principal = {
    id: randomUUID(),
    organizationId: ORG,
    accountType: 'super-admin',
    sessionVersion: 1,
  };
  return createRequestContext({
    organizationId: ORG,
    principal,
    requestId: 'test-employee-id',
  });
}

describe.skipIf(!enabled)('employee ID allocation (PostgreSQL)', () => {
  beforeAll(async () => {
    if (!new URL(migrationUrl).pathname.includes('test'))
      throw new Error('refusing non-test database');

    await asOwner(
      'create test organization',
      sql`INSERT INTO organization (id, code, name) VALUES (${ORG}, ${`EI${ORG.slice(0, 6)}`}, 'Employee ID Test')`,
    );
    await asOwner(
      'create test department',
      sql`INSERT INTO department (id, organization_id, code, name, kind)
          VALUES (${DEPT}, ${ORG}, 'ENG', 'Engineering', 'development')`,
    );
    await asOwner(
      'create test position',
      sql`INSERT INTO position (id, organization_id, department_id, code, name, organizational_level)
          VALUES (${POS}, ${ORG}, ${DEPT}, 'ENG-1', 'Engineer', 20)`,
    );
  });

  afterAll(async () => {
    await asOwner(
      'remove directory rows',
      sql`DELETE FROM identity_email_directory WHERE organization_id = ${ORG}`,
    );
    await asOwner(
      'remove test users',
      sql`DELETE FROM app_user WHERE organization_id = ${ORG}`,
    );
    await asOwner(
      'remove test organization',
      sql`DELETE FROM organization WHERE id = ${ORG}`,
    );
    await closePools();
  });

  it('allocates sequential IDs starting at the seed default (EMP-00001)', async () => {
    const first = await db.transaction(ctx(), (tx) => allocateEmployeeId(tx, ORG));
    const second = await db.transaction(ctx(), (tx) => allocateEmployeeId(tx, ORG));
    const third = await db.transaction(ctx(), (tx) => allocateEmployeeId(tx, ORG));
    expect(first).toBe('EMP-00001');
    expect(second).toBe('EMP-00002');
    expect(third).toBe('EMP-00003');
  });

  it('skips existing employee IDs in db and advances sequentially', async () => {
    // Seed an employee with EMP-00007 directly in app_user
    const user7 = randomUUID();
    await asOwner(
      'seed employee with EMP-00007',
      sql`INSERT INTO app_user (id, organization_id, account_type, employee_id, email, full_name, position_id, department_id)
          VALUES (${user7}, ${ORG}, 'employee', 'EMP-00007', ${`emp7-${user7}@t.io`}, 'Emp Seven', ${POS}, ${DEPT})`,
    );

    // Peeking next employee ID should detect EMP-00007 and return EMP-00008
    const peeked = await db.transaction(ctx(), (tx) => peekNextEmployeeId(tx, ORG));
    expect(peeked).toBe('EMP-00008');

    // Peeking with hint of EMP-00007 should advance to EMP-00008
    const peekedWithHint = await db.transaction(ctx(), (tx) => peekNextEmployeeId(tx, ORG, 'EMP-00007'));
    expect(peekedWithHint).toBe('EMP-00008');

    // Allocating should give EMP-00008 and advance counter
    const allocated = await db.transaction(ctx(), (tx) => allocateEmployeeId(tx, ORG));
    expect(allocated).toBe('EMP-00008');

    // Next peek should now be EMP-00009
    const nextPeek = await db.transaction(ctx(), (tx) => peekNextEmployeeId(tx, ORG));
    expect(nextPeek).toBe('EMP-00009');
  });

  it('reports whether an employee ID is in use for the organization', async () => {
    const userId = randomUUID();
    await asOwner(
      'seed one employee with a known ID',
      sql`INSERT INTO app_user (id, organization_id, account_type, employee_id, email, full_name, position_id, department_id)
          VALUES (${userId}, ${ORG}, 'employee', 'EMP-CHECK', ${`check-${userId}@t.io`}, 'Check', ${POS}, ${DEPT})`,
    );
    const present = await db.transaction(ctx(), (tx) =>
      employeeIdExists(tx, ORG, 'EMP-CHECK'),
    );
    const absent = await db.transaction(ctx(), (tx) =>
      employeeIdExists(tx, ORG, 'EMP-DOES-NOT-EXIST'),
    );
    expect(present).toBe(true);
    expect(absent).toBe(false);
  });

  it('rejects a duplicate employee_id at the database level', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await asOwner(
      'insert first user with dupe ID',
      sql`INSERT INTO app_user (id, organization_id, account_type, employee_id, email, full_name, position_id, department_id)
          VALUES (${userA}, ${ORG}, 'employee', 'EMP-DUPE', ${`a-${userA}@t.io`}, 'A', ${POS}, ${DEPT})`,
    );
    await expect(
      asOwner(
        'insert second user with dupe ID',
        sql`INSERT INTO app_user (id, organization_id, account_type, employee_id, email, full_name, position_id, department_id)
            VALUES (${userB}, ${ORG}, 'employee', 'EMP-DUPE', ${`b-${userB}@t.io`}, 'B', ${POS}, ${DEPT})`,
      ),
    ).rejects.toThrow();
  });

  it('rejects a lowercase employee_id at the database level', async () => {
    const userId = randomUUID();
    await expect(
      asOwner(
        'insert user with lowercase ID',
        sql`INSERT INTO app_user (id, organization_id, account_type, employee_id, email, full_name, position_id, department_id)
            VALUES (${userId}, ${ORG}, 'employee', 'emp-lower', ${`lower-${userId}@t.io`}, 'Lower', ${POS}, ${DEPT})`,
      ),
    ).rejects.toThrow();
  });

  it('rejects an employee row without an employee_id', async () => {
    const userId = randomUUID();
    await expect(
      asOwner(
        'insert employee without ID',
        sql`INSERT INTO app_user (id, organization_id, account_type, email, full_name, position_id, department_id)
            VALUES (${userId}, ${ORG}, 'employee', ${`noid-${userId}@t.io`}, 'NoId', ${POS}, ${DEPT})`,
      ),
    ).rejects.toThrow();
  });
});
