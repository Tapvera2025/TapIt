import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { platformDb } from '../../../platform/dal/db.js';
import { closePools } from '../../../platform/dal/pool.js';
import { sql } from '../../../platform/dal/sql.js';
import { devInstantPasswordReset } from './dev-reset.js';
import { hashIdentityPassword, verifyIdentityPassword } from './service.js';

/**
 * The development-only instant reset against REAL PostgreSQL through the
 * runtime role: only company admins, the password works at once, and old
 * sessions and emailed reset links stop working.
 *
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=... DATABASE_URL=... \
 *   REDIS_URL=... JWT_ACCESS_SECRET=... JWT_REFRESH_SECRET=... \
 *   npx vitest run packages/server/src/modules/identity/password
 */
const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
const migrationUrl = process.env['MIGRATION_DATABASE_URL'] ?? '';

describe.skipIf(!enabled)('development instant password reset (PostgreSQL)', () => {
  const org = randomUUID();
  const dept = randomUUID();
  const position = randomUUID();
  const admin = randomUUID();
  const employee = randomUUID();
  const adminEmail = `admin-${admin}@dev-reset-test.invalid`;
  const employeeEmail = `staff-${employee}@dev-reset-test.invalid`;
  let oldHash = '';

  const asOwner = <T = unknown>(reason: string, fragment: ReturnType<typeof sql>) =>
    platformDb.query<T>('migration', reason, fragment);

  beforeAll(async () => {
    const dbName = new URL(migrationUrl).pathname;
    if (!dbName.includes('test')) throw new Error(`Refusing to run against "${dbName}"`);
    oldHash = await hashIdentityPassword('Old-Password-Value-2026');
    await asOwner('seed org', sql`INSERT INTO organization (id, code, name) VALUES (${org}, ${`DRS${org.slice(0, 6)}`}, 'Dev Reset Co')`);
    await asOwner('seed dept', sql`INSERT INTO department (id, organization_id, code, name, kind) VALUES (${dept}, ${org}, 'OPS', 'Ops', 'support')`);
    await asOwner('seed position', sql`INSERT INTO position (id, organization_id, department_id, code, name, organizational_level) VALUES (${position}, ${org}, ${dept}, 'OPX', 'Ops', 20)`);
    await asOwner('seed admin', sql`
      INSERT INTO app_user (id, organization_id, account_type, email, status, full_name, password_hash, must_change_password, locked_until)
      VALUES (${admin}, ${org}, 'super-admin', ${adminEmail}, 'active', 'Asha Admin', ${oldHash}, true, now() + interval '1 hour')`);
    await asOwner('seed employee', sql`
      INSERT INTO app_user (id, organization_id, account_type, email, status, full_name, password_hash, employee_id, department_id, position_id)
      VALUES (${employee}, ${org}, 'employee', ${employeeEmail}, 'active', 'Sam Staff', ${oldHash}, 'DRS-1', ${dept}, ${position})`);
    await asOwner('seed session', sql`
      INSERT INTO session (organization_id, user_id, session_version, expires_at)
      VALUES (${org}, ${admin}, 1, now() + interval '1 day')`);
    await asOwner('seed reset link', sql`
      INSERT INTO password_reset_token (organization_id, user_id, token_hash, expires_at)
      VALUES (${org}, ${admin}, ${`hash-${admin}`}, now() + interval '30 minutes')`);
  });

  afterAll(async () => {
    await asOwner('cleanup audit outbox', sql`DELETE FROM audit_outbox WHERE organization_id = ${org}`);
    for (const table of ['password_reset_token', 'session', 'identity_email_directory', 'app_user', 'position', 'department']) {
      await asOwner(`cleanup ${table}`, sql`DELETE FROM ${sql.raw(table)} WHERE organization_id = ${org}`);
    }
    await asOwner('cleanup org', sql`DELETE FROM organization WHERE id = ${org}`);
    await closePools();
  });

  it('gives a company admin a new password that works at once', async () => {
    const result = await devInstantPasswordReset(adminEmail.toUpperCase(), '127.0.0.1');
    expect(result.email).toBe(adminEmail);
    expect(result.password).toMatch(/^Dev-\w{4}-\w{4}-\w{4}$/);

    const [user] = await asOwner<{ passwordHash: string; mustChangePassword: boolean; lockedUntil: Date | null; sessionVersion: number }>(
      'read admin',
      sql`SELECT password_hash, must_change_password, locked_until, session_version FROM app_user WHERE id = ${admin}`,
    );
    expect(await verifyIdentityPassword(user!.passwordHash, result.password)).toBe(true);
    expect(await verifyIdentityPassword(user!.passwordHash, 'Old-Password-Value-2026')).toBe(false);
    expect(user).toMatchObject({ mustChangePassword: false, lockedUntil: null });
    expect(user!.sessionVersion).toBeGreaterThan(1);

    const [open] = await asOwner<{ sessions: number; links: number; events: number }>('read side effects', sql`
      SELECT
        (SELECT count(*)::int FROM session WHERE user_id = ${admin} AND revoked_at IS NULL) AS sessions,
        (SELECT count(*)::int FROM password_reset_token WHERE user_id = ${admin} AND used_at IS NULL) AS links,
        (SELECT count(*)::int FROM audit_outbox WHERE organization_id = ${org} AND payload->>'action' = 'identity.dev_password_reset') AS events`);
    expect(open).toEqual({ sessions: 0, links: 0, events: 1 });
  });

  it('leaves employees to the emailed reset link', async () => {
    await expect(devInstantPasswordReset(employeeEmail, '127.0.0.1')).rejects.toMatchObject({ code: 'IDENTITY_DEV_RESET_ADMIN_ONLY' });
    const [user] = await asOwner<{ passwordHash: string }>('read employee', sql`SELECT password_hash FROM app_user WHERE id = ${employee}`);
    expect(user!.passwordHash).toBe(oldHash);
  });

  it('says so when no active account uses the address', async () => {
    await expect(devInstantPasswordReset('nobody@dev-reset-test.invalid', '127.0.0.1')).rejects.toMatchObject({ code: 'IDENTITY_DEV_RESET_NOT_FOUND' });
  });
});
