import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { platformDb } from '../dal/db.js';
import { closePools } from '../dal/pool.js';
import { sql } from '../dal/sql.js';
import { drainOrganization, MAX_OUTBOX_ATTEMPTS } from './drainer.js';
import { onOutboxEvent } from './registry.js';

/**
 * The domain outbox drainer against real PostgreSQL (design §5.5). An
 * ordinary event stops after ten failed deliveries. One registered to retry
 * until delivered raises its alert at that point and carries on.
 *
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=… DATABASE_URL=… npx vitest run <file>
 */
const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
const RUN = randomUUID().slice(0, 8);
const ORG = randomUUID();
const ORDINARY = `test.ordinary-${RUN}`;
const UNTIL_DELIVERED = `test.until-delivered-${RUN}`;
const asOwner = (reason: string, fragment: ReturnType<typeof sql>) =>
  platformDb.query('migration', reason, fragment);

let failing = true;
const delivered: string[] = [];
const deliver = async (event: { id: string }) => {
  if (failing) throw new Error('the consumer is down');
  delivered.push(event.id);
};

const writeEvent = async (name: string, attempts: number) =>
  (
    (await asOwner(
      'write outbox event',
      sql`
      INSERT INTO domain_outbox (organization_id, event_name, payload, attempts)
      VALUES (${ORG}, ${name}, '{}'::jsonb, ${attempts}) RETURNING id`,
    )) as { id: string }[]
  )[0]!.id;

const rowOf = async (id: string) =>
  (
    (await asOwner(
      'read outbox event',
      sql`SELECT attempts, processed_at FROM domain_outbox WHERE id = ${id}`,
    )) as { attempts: number; processedAt: Date | null }[]
  )[0]!;

describe.skipIf(!enabled)('domain outbox drainer (PostgreSQL)', () => {
  beforeAll(async () => {
    await asOwner(
      'create organization',
      sql`
      INSERT INTO organization (id, code, name, timezone) VALUES (${ORG}, ${`OB${RUN}`}, 'Outbox Test', 'Asia/Kolkata')`,
    );
    onOutboxEvent(ORDINARY, deliver);
    onOutboxEvent(UNTIL_DELIVERED, deliver, { retryUntilDelivered: true });
  });

  afterAll(async () => {
    await closePools();
  });

  it('an ordinary event is not claimed again after ten failed deliveries', async () => {
    failing = false;
    const id = await writeEvent(ORDINARY, MAX_OUTBOX_ATTEMPTS);
    await drainOrganization(ORG);
    expect(delivered).not.toContain(id);
    expect(await rowOf(id)).toEqual({ attempts: MAX_OUTBOX_ATTEMPTS, processedAt: null });
  });

  it('an event that retries until delivered alerts at its tenth failure, and is still delivered later', async () => {
    failing = true;
    const id = await writeEvent(UNTIL_DELIVERED, MAX_OUTBOX_ATTEMPTS - 1);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await drainOrganization(ORG);
    const lines = errors.mock.calls.flatMap(([line]): Record<string, unknown>[] => {
      try {
        return [JSON.parse(String(line)) as Record<string, unknown>];
      } catch {
        return [];
      }
    });
    errors.mockRestore();
    expect(lines.filter((line) => line['eventId'] === id)).toEqual([
      expect.objectContaining({
        alert: 'outbox-event-overdue',
        attempts: MAX_OUTBOX_ATTEMPTS,
      }),
    ]);
    expect(await rowOf(id)).toEqual({ attempts: MAX_OUTBOX_ATTEMPTS, processedAt: null });

    // Past the point where an ordinary event stops, it is still claimed.
    failing = false;
    await asOwner(
      'skip the backoff',
      sql`UPDATE domain_outbox SET claimed_until = NULL WHERE id = ${id}`,
    );
    await drainOrganization(ORG);
    expect(delivered).toContain(id);
    expect((await rowOf(id)).processedAt).toBeInstanceOf(Date);
  });
});
