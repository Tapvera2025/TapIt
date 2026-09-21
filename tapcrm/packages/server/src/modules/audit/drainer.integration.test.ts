import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Principal } from '@tapcrm/contracts';
import { closePools } from '../../platform/dal/pool.js';
import { createRequestContext, type RequestContext } from '../../platform/dal/context.js';
import { db, platformDb } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { verifyChain, type StoredChainEntry } from './chain.js';
import { drainOrganization } from './drainer.js';

/**
 * Runs the drainer against REAL PostgreSQL, through the runtime role, so RLS and
 * the append-only grants are exercised rather than assumed.
 *
 * Opt-in: needs a migrated database and refuses any whose name lacks "test".
 *
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=... DATABASE_URL=... \
 *   REDIS_URL=... JWT_ACCESS_SECRET=... JWT_REFRESH_SECRET=... npx vitest run <this file>
 */
const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
const migrationUrl = process.env['MIGRATION_DATABASE_URL'] ?? '';

describe.skipIf(!enabled)('audit drainer (PostgreSQL)', () => {
  const orgA = randomUUID();
  const orgB = randomUUID();

  /** Owner-role SQL (the `migration` platform operation) for setup, cleanup and tampering. */
  const asOwner = (reason: string, fragment: ReturnType<typeof sql>) =>
    platformDb.query('migration', reason, fragment);

  function ctxFor(organizationId: string): RequestContext {
    const principal: Principal = {
      id: randomUUID(),
      organizationId,
      sessionVersion: 1,
      accountType: 'super-admin',
    };
    return createRequestContext({ organizationId, principal, requestId: 'test' });
  }

  async function enqueue(
    organizationId: string,
    stream: 'access' | 'activity',
    payload: unknown,
  ): Promise<void> {
    await db.query(
      ctxFor(organizationId),
      sql`INSERT INTO audit_outbox (organization_id, stream, payload)
          VALUES (${organizationId}, ${stream}, ${JSON.stringify(payload)}::jsonb)`,
    );
  }

  async function stored(organizationId: string, stream: 'access' | 'activity') {
    const rows = await db.query<Record<string, unknown>>(
      ctxFor(organizationId),
      sql`SELECT * FROM audit_entry WHERE organization_id = ${organizationId} AND stream = ${stream}
          ORDER BY sequence`,
    );
    return rows.map(
      (row): StoredChainEntry => ({
        organizationId,
        stream,
        sequence: BigInt(row['sequence'] as string),
        occurredAt: row['occurredAt'] as Date,
        actorId: (row['actorId'] as string | null) ?? null,
        actorType: row['actorType'] as StoredChainEntry['actorType'],
        action: row['action'] as string,
        targetType: row['targetType'] as string,
        targetId: (row['targetId'] as string | null) ?? null,
        before: (row['beforeData'] as StoredChainEntry['before']) ?? null,
        after: (row['afterData'] as StoredChainEntry['after']) ?? null,
        reason: (row['reason'] as string | null) ?? null,
        sourceIp: (row['sourceIp'] as string | null) ?? null,
        requestId: (row['requestId'] as string | null) ?? null,
        prevHash: (row['prevHash'] as Buffer | null) ?? null,
        hash: row['hash'] as Buffer,
      }),
    );
  }

  async function pendingCount(organizationId: string): Promise<number> {
    const [row] = await db.query<{ n: string }>(
      ctxFor(organizationId),
      sql`SELECT count(*)::text AS n FROM audit_outbox WHERE processed_at IS NULL`,
    );
    return Number(row?.n);
  }

  beforeAll(async () => {
    const dbName = new URL(migrationUrl).pathname;
    if (!dbName.includes('test')) throw new Error(`Refusing to run against "${dbName}"`);
    for (const [id, code] of [[orgA, 'AUDA'], [orgB, 'AUDB']] as const) {
      await asOwner(
        'create test organization',
        sql`INSERT INTO organization (id, code, name)
            VALUES (${id}, ${`${code}${id.slice(0, 6)}`}, ${code})`,
      );
    }
  });

  afterAll(async () => {
    // The owner role, not the runtime role, removes test data: the application
    // cannot delete audit entries (AU-2).
    await asOwner(
      'remove test audit entries',
      sql`DELETE FROM audit_entry WHERE organization_id = ANY(${[orgA, orgB]}::uuid[])`,
    );
    await asOwner(
      'remove test organizations',
      sql`DELETE FROM organization WHERE id = ANY(${[orgA, orgB]}::uuid[])`,
    );
    await closePools();
  });

  it('chains outbox rows in order and produces a verifiable chain', async () => {
    for (let i = 1; i <= 5; i += 1) {
      await enqueue(orgA, 'activity', {
        action: `thing.changed.${i}`,
        actorId: randomUUID(),
        actorType: 'employee',
        targetType: 'thing',
        targetId: randomUUID(),
        before: { n: i - 1 },
        after: { n: i },
        sourceIp: '203.0.113.9',
        requestId: `r${i}`,
      });
    }
    expect(await drainOrganization(orgA)).toBe(5);

    const entries = await stored(orgA, 'activity');
    expect(entries.map((e) => e.sequence)).toEqual([1n, 2n, 3n, 4n, 5n]);
    expect(entries.map((e) => e.action)).toEqual([1, 2, 3, 4, 5].map((i) => `thing.changed.${i}`));
    expect(entries[0]?.prevHash).toBeNull();
    expect(verifyChain(entries)).toEqual([]);
    expect(await pendingCount(orgA)).toBe(0);
  });

  it('is idempotent: draining again writes nothing', async () => {
    const before = (await stored(orgA, 'activity')).length;
    expect(await drainOrganization(orgA)).toBe(0);
    expect((await stored(orgA, 'activity')).length).toBe(before);
  });

  it('continues the same chain across drains', async () => {
    await enqueue(orgA, 'activity', { action: 'later', targetType: 'thing' });
    await drainOrganization(orgA);
    const entries = await stored(orgA, 'activity');
    expect(entries.at(-1)?.sequence).toBe(6n);
    expect(verifyChain(entries)).toEqual([]);
  });

  it('keeps the two streams independent', async () => {
    await enqueue(orgA, 'access', { action: 'x:view', targetType: 'thing', kind: 'sensitive-use' });
    await drainOrganization(orgA);
    const access = await stored(orgA, 'access');
    expect(access.map((e) => e.sequence)).toEqual([1n]);
    expect(access[0]?.after).toEqual({ _context: { kind: 'sensitive-use' } });
    expect(verifyChain(access)).toEqual([]);
  });

  it('drains a backlog larger than the batch size', async () => {
    for (let i = 0; i < 10; i += 1) {
      await enqueue(orgB, 'activity', { action: `b.${i}`, targetType: 'thing' });
    }
    expect(await drainOrganization(orgB, 3)).toBe(10);
    const entries = await stored(orgB, 'activity');
    expect(entries.map((e) => e.sequence)).toEqual(
      Array.from({ length: 10 }, (_, i) => BigInt(i + 1)),
    );
    expect(verifyChain(entries)).toEqual([]);
  });

  it('allocates gapless sequences when two writers race (AU-I2)', async () => {
    const before = (await stored(orgA, 'activity')).length;
    for (let i = 0; i < 40; i += 1) {
      await enqueue(orgA, 'activity', { action: `race.${i}`, targetType: 'thing' });
    }
    const [x, y, z] = await Promise.all([
      drainOrganization(orgA, 7),
      drainOrganization(orgA, 7),
      drainOrganization(orgA, 7),
    ]);
    expect(x + y + z).toBe(40);

    const entries = await stored(orgA, 'activity');
    expect(entries).toHaveLength(before + 40);
    expect(verifyChain(entries)).toEqual([]);
    expect(new Set(entries.map((e) => e.action)).size).toBe(entries.length);
  });

  it('chains a malformed payload instead of blocking the stream', async () => {
    await enqueue(orgB, 'activity', { actorId: 'nope', actorType: 'wizard', sourceIp: 'bad' });
    await enqueue(orgB, 'activity', { action: 'after.poison', targetType: 'thing' });
    expect(await drainOrganization(orgB)).toBe(2);
    const entries = await stored(orgB, 'activity');
    const poisoned = entries.at(-2);
    expect(poisoned).toMatchObject({ action: 'unknown', actorType: 'system', actorId: null });
    expect(entries.at(-1)?.action).toBe('after.poison');
    expect(verifyChain(entries)).toEqual([]);
  });

  it('isolates tenants: one organization cannot read another\'s entries', async () => {
    const rows = await db.query(
      ctxFor(orgB),
      sql`SELECT 1 FROM audit_entry WHERE organization_id = ${orgA}`,
    );
    expect(rows).toEqual([]);
  });

  it('is append-only for the runtime role (AU-2)', async () => {
    await expect(
      db.query(ctxFor(orgA), sql`UPDATE audit_entry SET action = 'x' WHERE organization_id = ${orgA}`),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      db.query(ctxFor(orgA), sql`DELETE FROM audit_entry WHERE organization_id = ${orgA}`),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('detects tampering made with the owner role', async () => {
    await asOwner(
      'tamper with an audit entry',
      sql`UPDATE audit_entry SET action = 'tampered'
          WHERE organization_id = ${orgA} AND stream = 'activity' AND sequence = 3`,
    );
    const breaks = verifyChain(await stored(orgA, 'activity'));
    expect(breaks).toContainEqual({ sequence: 3n, reason: 'hash-mismatch' });
  });
});
