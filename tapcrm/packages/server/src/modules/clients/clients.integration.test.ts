import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Principal } from '@tapcrm/contracts';
import { installAuthz } from '../../platform/authz-adapter.js';
import { createRequestContext, type RequestContext } from '../../platform/dal/context.js';
import { platformDb } from '../../platform/dal/db.js';
import { closePools } from '../../platform/dal/pool.js';
import { sql } from '../../platform/dal/sql.js';
import { ClientEmailTakenError, ClientNotFoundError } from './errors.js';
import { registerClientPolicies } from './policy.js';
import {
  createClient,
  getClient,
  listClients,
  loadClientResource,
  revokeClientCredentials,
  setClientCredentials,
  updateClient,
} from './service.js';
import { clientListQuerySchema } from './validators.js';

/**
 * Runs the clients engine against REAL PostgreSQL through the runtime role,
 * so RLS, the region→currency/timezone snapshot, the client-login account
 * and the "creator or project participant" policy are all exercised rather
 * than assumed.
 *
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=... DATABASE_URL=... \
 *   REDIS_URL=... JWT_ACCESS_SECRET=... JWT_REFRESH_SECRET=... \
 *   npx vitest run packages/server/src/modules/clients
 */
const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
const migrationUrl = process.env['MIGRATION_DATABASE_URL'] ?? '';

describe.skipIf(!enabled)('clients engine (PostgreSQL)', () => {
  const orgA = randomUUID();
  const orgB = randomUUID();
  const deptA = randomUUID();
  const posA = randomUUID();
  const admin = randomUUID();
  const outsider = randomUUID();

  const asOwner = <T = unknown>(reason: string, fragment: ReturnType<typeof sql>) => platformDb.query<T>('migration', reason, fragment);

  function ctxFor(organizationId: string, userId: string): RequestContext {
    const principal: Principal = {
      id: userId, organizationId, accountType: 'employee', sessionVersion: 1,
      positionId: posA, departmentId: deptA, teamId: null, reportsTo: null, organizationalLevel: 1,
    };
    return createRequestContext({ organizationId, principal, requestId: `test-${userId}` });
  }
  const asAdmin = () => ctxFor(orgA, admin);

  beforeAll(async () => {
    const dbName = new URL(migrationUrl).pathname;
    if (!dbName.includes('test')) throw new Error(`Refusing to run against "${dbName}"`);
    installAuthz();
    registerClientPolicies();

    for (const [id, code] of [[orgA, 'CLTA'], [orgB, 'CLTB']] as const) {
      await asOwner('seed org', sql`INSERT INTO organization (id, code, name) VALUES (${id}, ${`${code}${id.slice(0, 6)}`}, ${code})`);
    }
    await asOwner('seed dept', sql`INSERT INTO department (id, organization_id, code, name, kind) VALUES (${deptA}, ${orgA}, 'D1', 'Dept', 'support')`);
    await asOwner('seed position', sql`INSERT INTO position (id, organization_id, department_id, code, name, organizational_level) VALUES (${posA}, ${orgA}, ${deptA}, 'PM', 'PM', 20)`);
    await asOwner('grant clients:view', sql`INSERT INTO position_policy (organization_id, position_id, action, allowed, scope) VALUES (${orgA}, ${posA}, 'clients:view', true, 'own')`);
    await asOwner(
      'seed admin user',
      sql`INSERT INTO app_user (id, organization_id, account_type, email, status, full_name, employee_id, department_id, position_id)
          VALUES (${admin}, ${orgA}, 'employee', 'admin@clients-test.invalid', 'active', 'Admin', 'CLIENTS-A1', ${deptA}, ${posA})`,
    );
    await asOwner(
      'seed outsider user',
      sql`INSERT INTO app_user (id, organization_id, account_type, email, status, full_name)
          VALUES (${outsider}, ${orgB}, 'super-admin', 'outsider@clients-test.invalid', 'active', 'Outsider')`,
    );
  });

  afterAll(async () => {
    const orgs = [orgA, orgB];
    // client.created_by -> app_user, and app_user.client_id -> client: the
    // client-type login rows (which REQUIRE client_id, so it cannot be
    // nulled) must go before `client`, which must go before the rest of
    // app_user (whom `client.created_by` points at).
    await asOwner('cleanup identity_email_directory', sql`DELETE FROM identity_email_directory WHERE organization_id = ANY(${orgs}::uuid[])`);
    await asOwner('cleanup client logins', sql`DELETE FROM app_user WHERE organization_id = ANY(${orgs}::uuid[]) AND account_type = 'client'`);
    await asOwner('cleanup client', sql`DELETE FROM client WHERE organization_id = ANY(${orgs}::uuid[])`);
    for (const table of ['app_user', 'position_policy', 'position', 'department']) {
      await asOwner(`cleanup ${table}`, sql`DELETE FROM ${sql.raw(table)} WHERE organization_id = ANY(${orgs}::uuid[])`);
    }
    await asOwner('cleanup orgs', sql`DELETE FROM organization WHERE id = ANY(${orgs}::uuid[])`);
    await closePools();
  });

  const newClientInput = (suffix: string) => ({
    clientName: `Contact ${suffix}`,
    businessName: `Business ${suffix}`,
    email: `client-${suffix}@clients-test.invalid`,
    password: 'a-genuinely-strong-password-99',
    region: 'in' as const,
  });

  it('creates a client with a real login account, and region snapshots currency + timezone', async () => {
    const client = await createClient(asAdmin(), newClientInput('create'));
    expect(client.currency).toBe('INR');
    expect(client.timezone).toBe('Asia/Kolkata');
    expect(client.hasActiveLogin).toBe(true);

    const [row] = await asOwner<{ accountType: string; clientId: string }>(
      'read',
      sql`SELECT account_type AS "accountType", client_id AS "clientId" FROM app_user WHERE organization_id = ${orgA} AND email = ${client.email}`,
    );
    expect(row?.accountType).toBe('client');
    expect(row?.clientId).toBe(client.id);
  });

  it('rejects a duplicate email (the identity directory is global, not per-client)', async () => {
    const input = newClientInput('dup');
    await createClient(asAdmin(), input);
    await expect(createClient(asAdmin(), { ...input, clientName: 'Someone Else' })).rejects.toThrow(ClientEmailTakenError);
  });

  it('a rolled-back creation (duplicate email) leaves no client row and no login behind', async () => {
    const input = newClientInput('rollback');
    await createClient(asAdmin(), input);
    const before = await asOwner<{ n: string }>('read', sql`SELECT count(*)::text AS n FROM client WHERE organization_id = ${orgA}`);

    await expect(createClient(asAdmin(), { ...input, clientName: 'Dup Attempt' })).rejects.toThrow();

    const after = await asOwner<{ n: string }>('read', sql`SELECT count(*)::text AS n FROM client WHERE organization_id = ${orgA}`);
    expect(after[0]?.n).toBe(before[0]?.n);
  });

  it('updates fields, and changing region re-snapshots currency and timezone', async () => {
    const client = await createClient(asAdmin(), newClientInput('update'));
    const updated = await updateClient(asAdmin(), client.id, { region: 'us' });
    expect(updated.currency).toBe('USD');
    expect(updated.timezone).toBe('America/New_York');
    expect(updated.clientName).toBe(client.clientName); // untouched fields survive a partial update
  });

  it('credentials: reset changes the password (and bumps session_version); revoke deactivates the login without touching the client record', async () => {
    const client = await createClient(asAdmin(), newClientInput('creds'));
    const [before] = await asOwner<{ sessionVersion: number }>('read', sql`SELECT session_version AS "sessionVersion" FROM app_user WHERE organization_id = ${orgA} AND client_id = ${client.id}`);

    await setClientCredentials(asAdmin(), client.id, { password: 'another-strong-password-77' });
    const [afterReset] = await asOwner<{ sessionVersion: number }>('read', sql`SELECT session_version AS "sessionVersion" FROM app_user WHERE organization_id = ${orgA} AND client_id = ${client.id}`);
    expect(afterReset!.sessionVersion).toBeGreaterThan(before!.sessionVersion);

    const revoked = await revokeClientCredentials(asAdmin(), client.id);
    expect(revoked.hasActiveLogin).toBe(false);
    const stillThere = await getClient(asAdmin(), client.id);
    expect(stillThere.status).toBe('active'); // the CLIENT record is untouched; only the login was revoked
    expect(stillThere.hasActiveLogin).toBe(false);
  });

  it('enforces multi-tenant isolation: a foreign organization sees nothing', async () => {
    const client = await createClient(asAdmin(), newClientInput('tenant'));
    const ctxB = ctxFor(orgB, outsider);
    await expect(getClient(ctxB, client.id)).rejects.toThrow(ClientNotFoundError);
    expect(await loadClientResource(ctxB, client.id)).toBeNull();
  });

  it('membership decides listing visibility: an employee not involved with a client does not see it, even holding clients:view', async () => {
    await createClient(asAdmin(), newClientInput('listing'));
    const stranger = randomUUID();
    await asOwner(
      'seed stranger user',
      sql`INSERT INTO app_user (id, organization_id, account_type, email, status, full_name, employee_id, department_id, position_id)
          VALUES (${stranger}, ${orgA}, 'employee', 'stranger@clients-test.invalid', 'active', 'Stranger', 'CLIENTS-A2', ${deptA}, ${posA})`,
    );
    const page = await listClients(ctxFor(orgA, stranger), clientListQuerySchema.parse({}));
    expect(page.items).toEqual([]);

    const own = await listClients(asAdmin(), clientListQuerySchema.parse({}));
    expect(own.items.length).toBeGreaterThan(0); // the admin created these, so they are the creator
  });
});
