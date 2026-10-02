import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../config.js';
import { platformDb } from '../dal/db.js';
import { closePools } from '../dal/pool.js';
import { sql } from '../dal/sql.js';
import { AUTHORIZATION_EVENTS } from '../events.js';
import { startOutboxDrainer, stopOutboxDrainer } from '../outbox/drainer.js';
import { installSocketPrincipalResolver, startRealtime, stopRealtime } from './server.js';

/**
 * Design §5.5, done when: an outbox row reaches a connected socket in under a
 * second. Real PostgreSQL (the NOTIFY trigger and the drainer) and real Redis
 * (the Socket.IO adapter).
 *
 *   TAPCRM_INTEGRATION_DB=1 REDIS_URL=… MIGRATION_DATABASE_URL=… DATABASE_URL=… npx vitest run <file>
 */
const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
const ORG = randomUUID();
const USER = randomUUID();
const GOOD_TOKEN = `token-${USER}`;
const asOwner = (reason: string, fragment: ReturnType<typeof sql>) => platformDb.query('migration', reason, fragment);

let http: HttpServer;
let url = '';
const sockets: Socket[] = [];

function open(token: string): Socket {
  const socket = connect(url, {
    path: `${loadConfig().API_BASE_PATH}/socket.io`,
    auth: { token },
    transports: ['websocket'],
    reconnection: false,
  });
  sockets.push(socket);
  return socket;
}

describe.skipIf(!enabled)('realtime and the domain outbox (PostgreSQL and Redis)', () => {
  beforeAll(async () => {
    await asOwner('create test organization', sql`
      INSERT INTO organization (id, code, name, timezone)
      VALUES (${ORG}, ${`RT${ORG.slice(0, 6)}`}, 'Realtime Test', 'Asia/Kolkata')`);
    // Stands in for Identity's token check, which has its own tests.
    installSocketPrincipalResolver(async (token) =>
      token === GOOD_TOKEN
        ? {
            organizationId: ORG,
            expiresAt: new Date(Date.now() + 60_000),
            principal: { id: USER, organizationId: ORG, sessionVersion: 1, accountType: 'super-admin' },
          }
        : null,
    );
    http = createServer();
    await new Promise<void>((resolve) => http.listen(0, resolve));
    url = `http://localhost:${(http.address() as AddressInfo).port}`;
    await startRealtime(http);
    await startOutboxDrainer();
  });

  afterAll(async () => {
    for (const socket of sockets) socket.close();
    await stopOutboxDrainer();
    await stopRealtime();
    await new Promise((resolve) => http.close(resolve));
    await asOwner('remove outbox rows', sql`DELETE FROM domain_outbox WHERE organization_id = ${ORG}`);
    await asOwner('remove test organization', sql`DELETE FROM organization WHERE id = ${ORG}`);
    await closePools();
  });

  it('RT-1: a socket without a valid token is refused', async () => {
    const error = await new Promise<Error>((resolve) => open('forged').on('connect_error', resolve));
    expect(error.message).toBe('UNAUTHENTICATED');
  });

  it('done when: an outbox row reaches the connected socket in under a second, then RT-3 closes it', async () => {
    const socket = open(GOOD_TOKEN);
    await new Promise<void>((resolve, reject) => {
      socket.on('connect', () => resolve());
      socket.on('connect_error', reject);
    });

    const received = new Promise<{ at: number; payload: { eventId: string; positionId: string | null } }>((resolve) =>
      socket.on(AUTHORIZATION_EVENTS.PERMISSIONS_CHANGED, (payload) => resolve({ at: Date.now(), payload })),
    );
    const closed = new Promise<string>((resolve) => socket.on('disconnect', resolve));

    const sentAt = Date.now();
    const [row] = (await asOwner('write an outbox row', sql`
      INSERT INTO domain_outbox (organization_id, event_name, payload)
      VALUES (${ORG}, ${AUTHORIZATION_EVENTS.PERMISSIONS_CHANGED},
              ${JSON.stringify({ positionId: null, holderIds: [USER], reason: 'test' })}::jsonb)
      RETURNING id`)) as { id: string }[];

    const { at, payload } = await received;
    expect(at - sentAt).toBeLessThan(1_000);
    expect(payload.eventId).toBe(row!.id);
    expect(await closed).toBe('io server disconnect');

    // Marked processed once every handler has run (D22: at least once).
    let processedAt: Date | null = null;
    for (let i = 0; i < 40 && processedAt === null; i += 1) {
      const [state] = (await asOwner('read the outbox row', sql`
        SELECT processed_at FROM domain_outbox WHERE id = ${row!.id}`)) as { processedAt: Date | null }[];
      processedAt = state?.processedAt ?? null;
      if (processedAt === null) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(processedAt).toBeInstanceOf(Date);
  });
});
