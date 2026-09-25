import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Principal } from '@tapcrm/contracts';
import { closePools } from '../../platform/dal/pool.js';
import { createRequestContext, type RequestContext } from '../../platform/dal/context.js';
import { db, platformDb } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { errorHandler } from '../../platform/http/error-handler.js';
import { notify } from './facade.js';
import { registerNotificationRoutes } from './routes.js';
import { dispatchOrganization } from './dispatcher.js';
import { countUnread, listForRecipient, markAllReadForRecipient, markOneRead, pruneExpired } from './repository.js';

/**
 * Runs the notification engine against REAL PostgreSQL through the runtime
 * role, so RLS, the outbox and the per-recipient fan-out are exercised rather
 * than assumed.
 *
 * Opt-in: needs a migrated database and refuses any whose name lacks "test".
 *
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=... DATABASE_URL=... \
 *   REDIS_URL=... JWT_ACCESS_SECRET=... JWT_REFRESH_SECRET=... \
 *   npx vitest run packages/server/src/modules/notifications
 */
vi.mock('../identity/index.js', () => ({
  resolvePrincipal: async (req: { header(name: string): string | undefined }) => {
    const userId = req.header('x-test-user');
    const organizationId = req.header('x-test-org');
    if (!userId || !organizationId) return null;
    return { organizationId, principal: { id: userId, organizationId, sessionVersion: 1, accountType: 'employee' } };
  },
}));

const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
const migrationUrl = process.env['MIGRATION_DATABASE_URL'] ?? '';

describe.skipIf(!enabled)('notification engine (PostgreSQL)', () => {
  const orgA = randomUUID();
  const orgB = randomUUID();
  const deptA = randomUUID();
  const positionA = randomUUID();
  const positionB = randomUUID(); // holds nothing
  const admin = randomUUID();
  const alice = randomUUID(); // position A: holds the action
  const bob = randomUUID(); // position B: does not
  const carol = randomUUID(); // position A, but an override DENIES the action
  const dave = randomUUID(); // position B, but an override GRANTS the action
  const eve = randomUUID(); // position A, inactive
  const outsider = randomUUID(); // organization B
  const ACTION = 'audit:view';

  const asOwner = <T = unknown>(reason: string, fragment: ReturnType<typeof sql>) =>
    platformDb.query<T>('migration', reason, fragment);

  function ctxFor(organizationId: string, userId: string): RequestContext {
    const principal: Principal = { id: userId, organizationId, sessionVersion: 1, accountType: 'super-admin' };
    return createRequestContext({ organizationId, principal, requestId: 'test' });
  }

  const emails = new Map<string, string>();
  async function addUser(
    organizationId: string,
    id: string,
    type: 'super-admin' | 'employee',
    positionId: string | null,
    status = 'active',
  ): Promise<void> {
    const email = `${id}@notify-test.invalid`;
    emails.set(id, email);
    await asOwner(
      'seed test user',
      sql`INSERT INTO app_user (id, organization_id, account_type, email, status, full_name, position_id, department_id, employee_id)
          VALUES (${id}, ${organizationId}, ${type}, ${email}, ${status}, ${`User ${id.slice(0, 4)}`},
                  ${positionId}, ${type === 'employee' ? deptA : null},
                  ${type === 'employee' ? `T${id.slice(0, 8).toUpperCase()}` : null})`,
    );
  }

  beforeAll(async () => {
    const dbName = new URL(migrationUrl).pathname;
    if (!dbName.includes('test')) throw new Error(`Refusing to run against "${dbName}"`);

    for (const [id, code] of [[orgA, 'NTFA'], [orgB, 'NTFB']] as const) {
      await asOwner('seed org', sql`INSERT INTO organization (id, code, name) VALUES (${id}, ${`${code}${id.slice(0, 6)}`}, ${code})`);
    }
    await asOwner('seed dept', sql`INSERT INTO department (id, organization_id, code, name, kind) VALUES (${deptA}, ${orgA}, 'D1', 'Dept', 'support')`);
    for (const [id, code] of [[positionA, 'PA'], [positionB, 'PB']] as const) {
      await asOwner(
        'seed position',
        sql`INSERT INTO position (id, organization_id, department_id, code, name, organizational_level)
            VALUES (${id}, ${orgA}, ${deptA}, ${code}, ${code}, 10)`,
      );
    }
    await asOwner(
      'seed policy',
      sql`INSERT INTO position_policy (organization_id, position_id, action, allowed, scope)
          VALUES (${orgA}, ${positionA}, ${ACTION}, true, 'own')`,
    );

    await addUser(orgA, admin, 'super-admin', null);
    await addUser(orgA, alice, 'employee', positionA);
    await addUser(orgA, bob, 'employee', positionB);
    await addUser(orgA, carol, 'employee', positionA);
    await addUser(orgA, dave, 'employee', positionB);
    await addUser(orgA, eve, 'employee', positionA, 'inactive');
    await addUser(orgB, outsider, 'super-admin', null);

    for (const [userId, allowed] of [[carol, false], [dave, true]] as const) {
      await asOwner(
        'seed override',
        sql`INSERT INTO user_override (organization_id, user_id, action, allowed, scope, reason, granted_by)
            VALUES (${orgA}, ${userId}, ${ACTION}, ${allowed}, 'own', 'test', ${admin})`,
      );
    }
  });

  afterAll(async () => {
    const orgs = [orgA, orgB];
    for (const table of ['identity_email_directory', 'notification_delivery', 'notification', 'notification_outbox', 'user_override', 'app_user', 'position_policy', 'position', 'department']) {
      await asOwner(`cleanup ${table}`, sql`DELETE FROM ${sql.raw(table)} WHERE organization_id = ANY(${orgs}::uuid[])`);
    }
    await asOwner('cleanup orgs', sql`DELETE FROM organization WHERE id = ANY(${orgs}::uuid[])`);
    await closePools();
  });

  const actor = () => ctxFor(orgA, admin);
  const recipientsOf = async (type: string): Promise<string[]> => {
    const rows = await asOwner<{ recipientId: string }>(
      'read',
      sql`SELECT recipient_id FROM notification WHERE type = ${type} ORDER BY recipient_id`,
    );
    return rows.map((r) => r.recipientId).sort();
  };

  it('a rolled-back business transaction produces no notification', async () => {
    await expect(
      db.transaction(actor(), async (tx) => {
        await notify(tx, actor(), { type: 'test.rollback', audience: { users: [alice] }, title: 'never' });
        throw new Error('business failure');
      }),
    ).rejects.toThrow('business failure');

    expect(await dispatchOrganization(orgA)).toBe(0);
    expect(await recipientsOf('test.rollback')).toEqual([]);
  });

  it('delivers to explicit users only after dispatch, one row per recipient', async () => {
    await db.transaction(actor(), (tx) => notify(tx, actor(), { type: 'test.users', audience: { users: [alice, bob] }, title: 'Hello' }));
    expect(await recipientsOf('test.users')).toEqual([]); // outbox only, nothing fanned out yet

    expect(await dispatchOrganization(orgA)).toBe(2);
    expect(await recipientsOf('test.users')).toEqual([alice, bob].sort());
  });

  it('replaying the dispatcher is a no-op', async () => {
    expect(await dispatchOrganization(orgA)).toBe(0);
    expect(await recipientsOf('test.users')).toHaveLength(2);
  });

  it('holders audience follows the authorization model: policy, override-deny, override-grant, inactive, super-admin', async () => {
    await db.transaction(actor(), (tx) =>
      notify(tx, actor(), { type: 'test.holders', audience: { holders: { action: ACTION }, includeActor: true }, title: 'Audit' }),
    );
    await dispatchOrganization(orgA);
    // alice (policy) + dave (override grant) + admin (super-admin, includeActor).
    // NOT bob (no policy), carol (override deny), eve (inactive).
    expect(await recipientsOf('test.holders')).toEqual([admin, alice, dave].sort());
  });

  it('never notifies the actor by default', async () => {
    await db.transaction(actor(), (tx) => notify(tx, actor(), { type: 'test.actor', audience: { users: [admin, alice] }, title: 'x' }));
    await dispatchOrganization(orgA);
    expect(await recipientsOf('test.actor')).toEqual([alice]);
  });

  it('never leaks across tenants: a foreign user id in the audience is dropped', async () => {
    await db.transaction(actor(), (tx) => notify(tx, actor(), { type: 'test.tenant', audience: { users: [outsider, alice] }, title: 'x' }));
    await dispatchOrganization(orgA);
    expect(await recipientsOf('test.tenant')).toEqual([alice]);
    // and the other tenant sees nothing of org A's rows
    expect(await listForRecipient(ctxFor(orgB, outsider), { unreadOnly: false, limit: 50, cursor: null })).toEqual([]);
  });

  it('a malformed outbox payload leaves the queue instead of retrying forever', async () => {
    await db.query(actor(), sql`INSERT INTO notification_outbox (organization_id, payload) VALUES (${orgA}, '{"nonsense":true}'::jsonb)`);
    expect(await dispatchOrganization(orgA)).toBe(0);
    const [row] = await asOwner<{ n: string }>('read', sql`SELECT count(*)::text AS n FROM notification_outbox WHERE processed_at IS NULL AND organization_id = ${orgA}`);
    expect(row?.n).toBe('0');
  });

  it('read APIs are scoped to the recipient: list, count, mark one, mark all', async () => {
    const aliceCtx = ctxFor(orgA, alice);
    const bobCtx = ctxFor(orgA, bob);

    const aliceList = await listForRecipient(aliceCtx, { unreadOnly: false, limit: 50, cursor: null });
    expect(aliceList.length).toBeGreaterThan(0);
    expect(await countUnread(aliceCtx)).toBe(aliceList.length);

    // Bob cannot mark Alice's notification read — indistinguishable from not found.
    expect(await markOneRead(bobCtx, aliceList[0]!.id)).toBeNull();
    expect(await countUnread(aliceCtx)).toBe(aliceList.length);

    const marked = await markOneRead(aliceCtx, aliceList[0]!.id);
    expect(marked?.read).toBe(true);
    expect(await countUnread(aliceCtx)).toBe(aliceList.length - 1);

    await markAllReadForRecipient(aliceCtx);
    expect(await countUnread(aliceCtx)).toBe(0);
    expect(await listForRecipient(aliceCtx, { unreadOnly: true, limit: 50, cursor: null })).toEqual([]);
  });

  it('keyset pagination walks the whole history without gaps or repeats', async () => {
    const ctx = ctxFor(orgA, alice);
    const all = await listForRecipient(ctx, { unreadOnly: false, limit: 50, cursor: null });
    const seen: string[] = [];
    let cursor: { createdAt: Date; id: string } | null = null;
    for (let guard = 0; guard < 50; guard += 1) {
      const page = await listForRecipient(ctx, { unreadOnly: false, limit: 2, cursor });
      if (page.length === 0) break;
      seen.push(...page.map((n) => n.id));
      const last = page[page.length - 1]!;
      cursor = { createdAt: new Date(last.createdAt), id: last.id };
    }
    expect(seen).toEqual(all.map((n) => n.id));
  });

  it('records an in-app delivery per notification and prunes expired ones while keeping the log', async () => {
    const [before] = await asOwner<{ n: string }>('read', sql`SELECT count(*)::text AS n FROM notification_delivery WHERE organization_id = ${orgA} AND channel = 'in-app' AND status = 'delivered'`);
    const [notifications] = await asOwner<{ n: string }>('read', sql`SELECT count(*)::text AS n FROM notification WHERE organization_id = ${orgA}`);
    expect(before?.n).toBe(notifications?.n);

    await asOwner('expire', sql`UPDATE notification SET expires_at = now() - interval '1 day' WHERE organization_id = ${orgA}`);
    expect(await listForRecipient(ctxFor(orgA, alice), { unreadOnly: false, limit: 50, cursor: null })).toEqual([]);
    const pruned = await db.transaction(actor(), (tx) => pruneExpired(tx, orgA));
    expect(pruned).toBe(Number(notifications?.n));
    const [after] = await asOwner<{ n: string }>('read', sql`SELECT count(*)::text AS n FROM notification_delivery WHERE organization_id = ${orgA}`);
    expect(after?.n).toBe(before?.n); // NT-8: the delivery log outlives the notification
  });

  describe('HTTP API', () => {
    const app = express();
    const router = express.Router();
    registerNotificationRoutes(router);
    app.use('/api', router);
    app.use(errorHandler);
    const as = (org: string, user: string) => ({ 'x-test-org': org, 'x-test-user': user });

    beforeAll(async () => {
      for (let i = 1; i <= 5; i += 1) {
        await db.transaction(actor(), (tx) =>
          notify(tx, actor(), { type: 'test.http', audience: { users: [alice] }, title: `Item ${i}`, link: `/things/${i}`, priority: i === 1 ? 'operational' : 'informational' }),
        );
      }
      await dispatchOrganization(orgA);
    });

    it('requires authentication', async () => {
      const res = await request(app).get('/api/notifications');
      expect(res.status).toBe(401);
    });

    it('lists only the caller notifications with a working cursor', async () => {
      const first = await request(app).get('/api/notifications?limit=2').set(as(orgA, alice));
      expect(first.status).toBe(200);
      expect(first.body.data.notifications).toHaveLength(2);
      expect(first.body.data.unreadCount).toBe(5);
      expect(first.body.data.nextCursor).toEqual(expect.any(String));

      type Page = { data: { notifications: Array<{ id: string }>; nextCursor: string | null } };
      const seen = new Set<string>((first.body as Page).data.notifications.map((n) => n.id));
      let cursor: string | null = (first.body as Page).data.nextCursor;
      while (cursor) {
        const page = (await request(app).get(`/api/notifications?limit=2&cursor=${cursor}`).set(as(orgA, alice))).body as Page;
        page.data.notifications.forEach((n) => seen.add(n.id));
        cursor = page.data.nextCursor;
      }
      expect(seen.size).toBe(5);

      const bobList = await request(app).get('/api/notifications').set(as(orgA, bob));
      expect(bobList.body.data.notifications).toEqual([]);
      expect(bobList.body.data.unreadCount).toBe(0);
    });

    it('unread-count, mark one, mark all', async () => {
      const list = await request(app).get('/api/notifications').set(as(orgA, alice));
      const id: string = list.body.data.notifications[0].id;

      // Bob cannot touch Alice's notification: indistinguishable from not found.
      const foreign = await request(app).post(`/api/notifications/${id}/read`).set(as(orgA, bob));
      expect(foreign.status).toBe(404);
      expect((await request(app).get('/api/notifications/unread-count').set(as(orgA, alice))).body.data.unreadCount).toBe(5);

      const own = await request(app).post(`/api/notifications/${id}/read`).set(as(orgA, alice));
      expect(own.status).toBe(200);
      expect(own.body.data.notification.read).toBe(true);
      expect((await request(app).get('/api/notifications/unread-count').set(as(orgA, alice))).body.data.unreadCount).toBe(4);

      const unreadOnly = await request(app).get('/api/notifications?unread=true').set(as(orgA, alice));
      expect(unreadOnly.body.data.notifications).toHaveLength(4);

      const all = await request(app).post('/api/notifications/read-all').set(as(orgA, alice));
      expect(all.body.data.updated).toBe(4);
      expect((await request(app).get('/api/notifications/unread-count').set(as(orgA, alice))).body.data.unreadCount).toBe(0);
    });

    it('rejects malformed input instead of erroring', async () => {
      expect((await request(app).post('/api/notifications/not-a-uuid/read').set(as(orgA, alice))).status).toBe(422);
      expect((await request(app).get('/api/notifications?limit=9999').set(as(orgA, alice))).status).toBe(422);
      // A garbage cursor is ignored (treated as the first page) rather than 500ing.
      expect((await request(app).get('/api/notifications?cursor=%25%25').set(as(orgA, alice))).status).toBe(200);
    });
  });
});
