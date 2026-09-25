import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import { loadConfig } from '../../config.js';

/**
 * Realtime — TECH.md §3 `/realtime`, RT-1..RT-6.
 *
 * The socket is a SIGNAL layer, never a source of truth. Persistence lives in
 * PostgreSQL; a user who is offline, or whose socket is down, loses nothing —
 * they see it on the next fetch (RT-6: the client polls as a fallback).
 *
 *   RT-1  the handshake authenticates with the same token and session-version
 *         check as HTTP, and is re-checked while connected.
 *   RT-2  rooms are derived SERVER-SIDE at connect. Clients cannot join rooms;
 *         no `join` event is handled. Phase 1 joins only `user:<id>`.
 *   RT-4  payloads carry identifiers and a change type, never record bodies.
 */

export interface SocketIdentity {
  readonly userId: string;
  readonly organizationId: string;
}

/** Injected so this layer does not import a product module. */
export type SocketAuthenticator = (token: string, options?: { touch?: boolean }) => Promise<SocketIdentity | null>;

/** RT-5 event names emitted through `emitToUser`. */
export type RealtimeEvent = 'notification:new' | 'notification:read' | 'permissions:changed';

/** Tenant-qualified: user ids are unique, but the room name must still encode the tenant. */
export const userRoom = (organizationId: string, userId: string): string =>
  `org:${organizationId}:user:${userId}`;

const REVALIDATE_MS = 2 * 60_000;

/** No client-to-server events are handled at all (RT-2); the map is intentionally open. */
type NoEvents = Record<string, (...args: unknown[]) => void>;

interface SocketData {
  identity: SocketIdentity;
  token: string;
}
type RealtimeServer = Server<NoEvents, NoEvents, NoEvents, SocketData>;
type RealtimeSocket = Socket<NoEvents, NoEvents, NoEvents, SocketData>;

let io: RealtimeServer | null = null;
let redisClients: Redis[] = [];

export async function startRealtime(server: HttpServer, authenticate: SocketAuthenticator): Promise<void> {
  const config = loadConfig();
  io = new Server<NoEvents, NoEvents, NoEvents, SocketData>(server, {
    // Same-origin through the dev proxy / reverse proxy; CORS_ORIGIN is honoured
    // for split-origin deployments.
    cors: { origin: config.CORS_ORIGIN, credentials: true },
    serveClient: false,
  });

  try {
    const pub = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
    const sub = pub.duplicate();
    for (const client of [pub, sub]) client.on('error', (error) => logError('realtime redis error', error));
    await Promise.all([pub.connect(), sub.connect()]);
    redisClients = [pub, sub];
    io.adapter(createAdapter(pub, sub));
  } catch (error) {
    // Single-node fallback: fine for local development; in a multi-replica
    // deployment an emit only reaches sockets on the emitting node, and the
    // client's polling fallback (RT-6) covers the gap.
    logError('realtime running without Redis adapter', error);
  }

  io.use((socket, next) => {
    void (async () => {
      const raw: unknown = socket.handshake.auth['token'];
      const token = typeof raw === 'string' ? raw : '';
      const identity = token ? await authenticate(token) : null;
      if (!identity) return next(new Error('unauthorized'));
      socket.data.identity = identity;
      socket.data.token = token;
      next();
    })().catch(() => next(new Error('unauthorized')));
  });

  io.on('connection', (socket: RealtimeSocket) => {
    const { identity } = socket.data;
    void socket.join(userRoom(identity.organizationId, identity.userId));

    // RT-1 — a session revoked or a token expired while connected must not stay
    // subscribed. The client reconnects with a refreshed token.
    const timer = setInterval(() => {
      authenticate(socket.data.token, { touch: false })
        .then((current) => {
          if (!current || current.userId !== identity.userId) socket.disconnect(true);
        })
        .catch(() => socket.disconnect(true));
    }, REVALIDATE_MS);
    timer.unref();
    socket.on('disconnect', () => clearInterval(timer));
  });
}

/**
 * Best-effort emit. Never throws: persistence is the guarantee, the socket is
 * only "make it feel instant". Call AFTER the transaction commits (TX-2).
 */
export function emitToUser(organizationId: string, userId: string, event: RealtimeEvent, payload: Record<string, unknown>): void {
  try {
    io?.to(userRoom(organizationId, userId)).emit(event, payload);
  } catch (error) {
    logError(`realtime emit skipped (${event})`, error);
  }
}

export async function stopRealtime(): Promise<void> {
  await new Promise<void>((resolve) => (io ? void io.close(() => resolve()) : resolve()));
  io = null;
  await Promise.all(redisClients.map((client) => client.quit().catch(() => undefined)));
  redisClients = [];
}

function logError(msg: string, error: unknown): void {
  console.error(JSON.stringify({ level: 'warn', msg, error: error instanceof Error ? error.message : String(error) }));
}
