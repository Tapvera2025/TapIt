import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { emitToUser, startRealtime, stopRealtime, userRoom } from './index.js';

/**
 * No Redis in this test: startRealtime falls back to the in-memory adapter,
 * which is exactly the single-node path. What is asserted here is the part
 * that must hold on every node — authentication and room isolation.
 */

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const ALICE = { userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', organizationId: ORG_A };
const BOB = { userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', organizationId: ORG_A };
// Same user id as Alice but in another tenant: must NOT share a room.
const ALICE_OTHER_TENANT = { userId: ALICE.userId, organizationId: ORG_B };

const TOKENS: Record<string, { userId: string; organizationId: string }> = {
  'alice-token': ALICE,
  'bob-token': BOB,
  'other-tenant-token': ALICE_OTHER_TENANT,
};

describe('realtime', () => {
  let server: HttpServer;
  let url: string;
  const sockets: Socket[] = [];

  const open = (token?: string): Socket => {
    const socket = connect(url, {
      auth: token === undefined ? {} : { token },
      transports: ['websocket'],
      reconnection: false,
    });
    sockets.push(socket);
    return socket;
  };
  const connected = (socket: Socket) => new Promise<void>((resolve, reject) => {
    socket.on('connect', resolve);
    socket.on('connect_error', reject);
  });

  beforeAll(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.env['REDIS_URL'] ??= 'redis://127.0.0.1:59999';
    process.env['DATABASE_URL'] ??= 'postgres://x:y@127.0.0.1:1/z';
    process.env['MIGRATION_DATABASE_URL'] ??= 'postgres://x:y@127.0.0.1:1/z';
    process.env['JWT_ACCESS_SECRET'] ??= 'a'.repeat(40);
    process.env['JWT_REFRESH_SECRET'] ??= 'b'.repeat(40);
    server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await startRealtime(server, async (token) => TOKENS[token] ?? null);
  });

  afterAll(async () => {
    sockets.forEach((s) => s.close());
    await stopRealtime();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    vi.restoreAllMocks();
  });

  it('rejects a handshake with no token or an invalid token (RT-1)', async () => {
    await expect(connected(open())).rejects.toThrow('unauthorized');
    await expect(connected(open('forged'))).rejects.toThrow('unauthorized');
  });

  it('delivers only to the addressed user, and never across tenants (RT-2)', async () => {
    const alice = open('alice-token');
    const bob = open('bob-token');
    const otherTenant = open('other-tenant-token');
    await Promise.all([connected(alice), connected(bob), connected(otherTenant)]);

    const received = { alice: [] as unknown[], bob: [] as unknown[], other: [] as unknown[] };
    alice.on('notification:new', (p) => received.alice.push(p));
    bob.on('notification:new', (p) => received.bob.push(p));
    otherTenant.on('notification:new', (p) => received.other.push(p));

    emitToUser(ORG_A, ALICE.userId, 'notification:new', { id: 'n1', type: 'x' });
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(received.alice).toEqual([{ id: 'n1', type: 'x' }]);
    expect(received.bob).toEqual([]);
    expect(received.other).toEqual([]);
  });

  it('does not let a client join rooms of its own choosing (RT-2)', async () => {
    const bob = open('bob-token');
    await connected(bob);
    const heard: unknown[] = [];
    bob.on('notification:new', (p) => heard.push(p));
    bob.emit('join', userRoom(ORG_A, ALICE.userId));
    bob.emit('room:join', userRoom(ORG_A, ALICE.userId));
    await new Promise((resolve) => setTimeout(resolve, 50));

    emitToUser(ORG_A, ALICE.userId, 'notification:new', { id: 'n2' });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(heard).toEqual([]);
  });

  it('emitToUser never throws, even with no one connected', () => {
    expect(() => emitToUser(ORG_A, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'notification:new', {})).not.toThrow();
  });
});
