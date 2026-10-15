import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createJobContext, systemPrincipal } from '../../platform/dal/context.js';
import { db, platformDb } from '../../platform/dal/db.js';
import { closePools } from '../../platform/dal/pool.js';
import { sql } from '../../platform/dal/sql.js';

/**
 * Opt-in against a migrated test database, with DATABASE_URL using tapcrm_app.
 * Exercises journal isolation through the real application role rather than
 * relying only on the schema flags inspected by CI.
 */
const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';

describe.skipIf(!enabled)('payment webhook journal RLS (PostgreSQL)', () => {
  const orgA = randomUUID();
  const orgB = randomUUID();
  const eventA = randomUUID();
  const eventB = randomUUID();
  const unresolvedEvent = randomUUID();
  const eventIds = [eventA, eventB, unresolvedEvent];
  let fixturesStarted = false;

  const asOwner = (reason: string, fragment: ReturnType<typeof sql>) =>
    platformDb.query('migration', reason, fragment);

  const ctxFor = (organizationId: string) => createJobContext({
    organizationId,
    principal: systemPrincipal(organizationId),
    jobName: 'sales.payment-webhook-rls.test',
    runId: eventA,
  });

  beforeAll(async () => {
    const databaseUrls = ['DATABASE_URL', 'MIGRATION_DATABASE_URL'].map((name) => {
      const url = new URL(process.env[name] ?? '');
      if (!decodeURIComponent(url.pathname).includes('test')) {
        throw new Error(`Refusing to run ${name} against a non-test database`);
      }
      return url;
    });
    expect(databaseUrls[0]!.host).toBe(databaseUrls[1]!.host);
    expect(databaseUrls[0]!.pathname).toBe(databaseUrls[1]!.pathname);

    // health-check uses the runtime pool without adding tenant context.
    const role = await platformDb.one<{ roleName: string; bypassRls: boolean; superuser: boolean }>(
      'health-check',
      'verify the payment journal test uses the restricted application role',
      sql`
        SELECT current_user AS role_name, rolbypassrls AS bypass_rls, rolsuper AS superuser
        FROM pg_roles WHERE rolname = current_user
      `,
    );
    expect(role).toEqual({ roleName: 'tapcrm_app', bypassRls: false, superuser: false });

    fixturesStarted = true;
    for (const [id, label] of [[orgA, 'A'], [orgB, 'B']] as const) {
      await asOwner('seed payment journal test organization', sql`
        INSERT INTO organization (id, code, name)
        VALUES (${id}, ${`PWRLS${id.slice(0, 8)}`}, ${`Payment journal test ${label}`})
      `);
    }
    for (const [id, organizationId] of [
      [eventA, orgA], [eventB, orgB], [unresolvedEvent, null],
    ] as const) {
      await asOwner('seed payment journal isolation fixture', sql`
        INSERT INTO payment_webhook_event (
          id, organization_id, provider, event_id, raw_payload, signature_valid
        ) VALUES (${id}, ${organizationId}, 'razorpay', ${id}, ${Buffer.from('{}')}, true)
      `);
    }
  });

  afterAll(async () => {
    try {
      if (fixturesStarted) {
        await asOwner('clean up payment journal fixtures', sql`
          DELETE FROM payment_webhook_event WHERE id = ANY(${eventIds}::uuid[])
        `);
        await asOwner('clean up payment journal test organizations', sql`
          DELETE FROM organization WHERE id = ANY(${[orgA, orgB]}::uuid[])
        `);
      }
    } finally {
      await closePools();
    }
  });

  it('enables and forces row-level security', async () => {
    const flags = await platformDb.one<{ enabled: boolean; forced: boolean }>(
      'health-check',
      'inspect payment journal RLS flags',
      sql`
        SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced
        FROM pg_class WHERE oid = 'public.payment_webhook_event'::regclass
      `,
    );
    expect(flags).toEqual({ enabled: true, forced: true });
  });

  it('limits each tenant to its own events and hides unresolved events', async () => {
    for (const [organizationId, expectedId] of [[orgA, eventA], [orgB, eventB]] as const) {
      const rows = await db.query<{ id: string }>(ctxFor(organizationId), sql`
        SELECT id FROM payment_webhook_event WHERE id = ANY(${eventIds}::uuid[])
      `);
      expect(rows).toEqual([{ id: expectedId }]);
    }
  });

  it('returns no events without a tenant context, including after tenant reads', async () => {
    await db.query(ctxFor(orgA), sql`
      SELECT id FROM payment_webhook_event WHERE id = ${eventA}
    `);
    const rows = await platformDb.query<{ id: string }>(
      'health-check',
      'verify payment journal fails closed without tenant context',
      sql`SELECT id FROM payment_webhook_event WHERE id = ANY(${eventIds}::uuid[])`,
    );
    expect(rows).toEqual([]);
  });

  it('keeps the application role read-only', async () => {
    const privileges = await platformDb.one<{
      select: boolean;
      insert: boolean;
      update: boolean;
      delete: boolean;
      truncate: boolean;
      columnInsert: boolean;
      columnUpdate: boolean;
    }>(
      'health-check',
      'inspect payment journal application privileges',
      sql`
        SELECT
          has_table_privilege(current_user, 'public.payment_webhook_event', 'SELECT') AS select,
          has_table_privilege(current_user, 'public.payment_webhook_event', 'INSERT') AS insert,
          has_table_privilege(current_user, 'public.payment_webhook_event', 'UPDATE') AS update,
          has_table_privilege(current_user, 'public.payment_webhook_event', 'DELETE') AS delete,
          has_table_privilege(current_user, 'public.payment_webhook_event', 'TRUNCATE') AS truncate,
          has_any_column_privilege(current_user, 'public.payment_webhook_event', 'INSERT') AS column_insert,
          has_any_column_privilege(current_user, 'public.payment_webhook_event', 'UPDATE') AS column_update
      `,
    );
    expect(privileges).toEqual({
      select: true,
      insert: false,
      update: false,
      delete: false,
      truncate: false,
      columnInsert: false,
      columnUpdate: false,
    });
  });
});
