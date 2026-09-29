import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { platformDb } from '../../../platform/dal/db.js';
import { closePools } from '../../../platform/dal/pool.js';
import { sql } from '../../../platform/dal/sql.js';
import { fixedClock } from '../../../platform/time.js';
import type { IdentityUser } from '../authentication/principal.js';
import { enforceGeofencedLogin } from './service.js';

/**
 * WFH-2 / ID-18b — approved work from home is checked against the
 * organization's date (attendance design §2, problem 2; T-1).
 *
 * Opt-in, like the other database tests:
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=… DATABASE_URL=… npx vitest run <file>
 */
const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
const migrationUrl = process.env['MIGRATION_DATABASE_URL'] ?? '';

const ORG = randomUUID();
const DEPT = randomUUID();
const POS = randomUUID();
const EMPLOYEE = randomUUID();
const APPROVER = randomUUID();

const asOwner = (reason: string, fragment: ReturnType<typeof sql>) =>
  platformDb.query('migration', reason, fragment);

const employee: IdentityUser = {
  id: EMPLOYEE,
  organizationId: ORG,
  accountType: 'employee',
  email: `wfh-${EMPLOYEE}@t.io`,
  fullName: 'Remote Worker',
  passwordHash: null,
  status: 'active',
  organizationStatus: 'active',
  mustChangePassword: false,
  lockedUntil: null,
  sessionVersion: 1,
  positionId: POS,
  departmentId: DEPT,
  teamId: null,
  reportsTo: null,
  clientId: null,
  organizationalLevel: 20,
  geofenceRequired: true,
};

const login = { organizationId: ORG, userId: EMPLOYEE, accountType: 'employee' as const, user: employee };

describe.skipIf(!enabled)('approved WFH uses the organization date (PostgreSQL)', () => {
  beforeAll(async () => {
    if (!new URL(migrationUrl).pathname.includes('test')) throw new Error('refusing non-test database');
    await asOwner('create test organization', sql`
      INSERT INTO organization (id, code, name, timezone)
      VALUES (${ORG}, ${`WF${ORG.slice(0, 6)}`}, 'WFH Date Test', 'Asia/Kolkata')`);
    await asOwner('create test department', sql`
      INSERT INTO department (id, organization_id, code, name, kind)
      VALUES (${DEPT}, ${ORG}, 'OPS', 'Operations', 'operations')`);
    await asOwner('create test position', sql`
      INSERT INTO position (id, organization_id, department_id, code, name, organizational_level)
      VALUES (${POS}, ${ORG}, ${DEPT}, 'OPS-1', 'Operator', 20)`);
    await asOwner('create employee and approver', sql`
      INSERT INTO app_user (id, organization_id, account_type, employee_id, email, full_name, position_id, department_id, geofence_required)
      VALUES (${EMPLOYEE}, ${ORG}, 'employee', 'EMP-WFH01', ${employee.email}, 'Remote Worker', ${POS}, ${DEPT}, true),
             (${APPROVER}, ${ORG}, 'employee', 'EMP-WFH02', ${`approver-${APPROVER}@t.io`}, 'Approver', ${POS}, ${DEPT}, false)`);
    await asOwner('approve WFH for 25 September', sql`
      INSERT INTO work_from_home_day (organization_id, user_id, work_date, reason, approved_by)
      VALUES (${ORG}, ${EMPLOYEE}, '2026-09-25', 'Internet installation at home', ${APPROVER})`);
  });

  afterAll(async () => {
    await asOwner('remove WFH rows', sql`DELETE FROM work_from_home_day WHERE organization_id = ${ORG}`);
    await asOwner('remove directory rows', sql`DELETE FROM identity_email_directory WHERE organization_id = ${ORG}`);
    await asOwner('remove users', sql`DELETE FROM app_user WHERE organization_id = ${ORG}`);
    await asOwner('remove position', sql`DELETE FROM position WHERE organization_id = ${ORG}`);
    await asOwner('remove department', sql`DELETE FROM department WHERE organization_id = ${ORG}`);
    await asOwner('remove organization', sql`DELETE FROM organization WHERE id = ${ORG}`);
    await closePools();
  });

  it('at 00:30 IST on the 25th the WFH approval for the 25th applies, though UTC still says the 24th', async () => {
    await expect(
      enforceGeofencedLogin(login, fixedClock('2026-09-24T19:00:00Z')),
    ).resolves.toBeUndefined();
  });

  it('at 23:30 IST on the 24th there is no approval, so a location is required', async () => {
    await expect(
      enforceGeofencedLogin(login, fixedClock('2026-09-24T18:00:00Z')),
    ).rejects.toMatchObject({ code: 'IDENTITY_LOCATION_REQUIRED' });
  });
});
