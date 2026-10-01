import type { Server as HttpServer } from 'node:http';
import { createAdapter } from '@socket.io/redis-adapter';
import { effectivePolicy } from '@tapcrm/authz';
import { globalAccess, type Principal } from '@tapcrm/contracts';
import { Redis } from 'ioredis';
import { Server } from 'socket.io';
import { loadConfig } from '../../config.js';
import { scopeResolver } from '../authz-adapter.js';
import { createRequestContext } from '../dal/context.js';
import { AUTHORIZATION_EVENTS } from '../events.js';
import { onOutboxEvent } from '../outbox/registry.js';
import {
  personalRoom,
  subjectRooms,
  viewerRooms,
  type PeopleChannel,
  type Subject,
} from './rooms.js';

/**
 * Realtime — TECH §10, attendance design §5.5.
 *
 *   RT-1  The handshake checks the same token and session version as HTTP,
 *         through the resolver Identity installs. The socket is closed when
 *         the token expires; the client reconnects with a fresh one.
 *   RT-2  Rooms come from the permission set, joined at connect (rooms.ts).
 *   RT-3  On `permissions:changed` the holders' sockets are told, then closed.
 *         Reconnecting runs the handshake again, which works the rooms out
 *         afresh, so a narrowed permission leaves no room behind.
 *   RT-4  Payloads carry ids and a change type, never record bodies.
 *
 * The Redis adapter carries every emit to every API instance.
 */

export interface SocketIdentity {
  readonly principal?: Principal;
  /** Present for the public notification-only adapter; channel sockets need a principal. */
  readonly userId?: string;
  readonly organizationId: string;
  /** When the token stops being valid. */
  readonly expiresAt: Date;
}

export type SocketPrincipalResolver = (token: string, options?: { touch?: boolean }) => Promise<SocketIdentity | null>;

export class RealtimeUnavailableError extends Error {
  constructor() {
    super('Realtime is not running in this process');
    this.name = 'RealtimeUnavailableError';
  }
}

/** What the handshake leaves on each socket. */
interface SocketData {
  identity: SocketIdentity;
  rooms: string[];
  token: string;
}
type RealtimeServer = Server<Record<string, (payload: unknown) => void>, Record<string, (payload: Record<string, unknown>) => void>, Record<string, never>, SocketData>;

export type TypingAuthorizer = (organizationId: string, userId: string, conversationId: string) => Promise<readonly string[] | null>;
let typingAuthorizer: TypingAuthorizer | null = null;

/** Chat registers its membership check before the realtime listener starts. */
export function installTypingAuthorizer(authorizer: TypingAuthorizer): void {
  typingAuthorizer = authorizer;
}

let resolveSocket: SocketPrincipalResolver = async () => null;
const channels = new Map<string, PeopleChannel>();
let io: RealtimeServer | null = null;
let publisher: Redis | null = null;
let subscriber: Redis | null = null;
let permissionsHandlerRegistered = false;
const REVALIDATE_MS = 2 * 60_000;

/** Identity installs its token check at boot, as it does for HTTP. */
export function installSocketPrincipalResolver(resolver: SocketPrincipalResolver): void {
  resolveSocket = resolver;
}

/** A module declares a people channel once, at boot (e.g. live-status: `status`). */
export function definePeopleChannel(channel: PeopleChannel): void {
  if (channels.has(channel.name)) throw new Error(`Channel "${channel.name}" is defined twice`);
  channels.set(channel.name, channel);
}

async function roomsFor(identity: SocketIdentity): Promise<string[]> {
  const { principal, organizationId } = identity;
  const userId = principal?.id ?? identity.userId;
  if (!userId) throw new Error('Socket identity has no user id');
  const rooms = [personalRoom(organizationId, userId)];
  // Notification-only callers have no policy-bearing Principal. They receive
  // only their tenant-qualified personal room.
  if (!principal) return rooms;
  if (channels.size === 0) return rooms;
  const ctx = createRequestContext({ organizationId, principal, requestId: `socket:${principal.id}` });
  const everyone = globalAccess(principal);
  const employee = principal.accountType === 'employee';
  for (const channel of channels.values()) {
    const policy = everyone ? null : await effectivePolicy(ctx, channel.action);
    const scope = policy?.allowed === true ? policy.scope : null;
    rooms.push(
      ...viewerRooms(channel, {
        organizationId,
        userId: principal.id,
        everyone,
        scope,
        departmentId: employee ? principal.departmentId : null,
        teamIds: scope === 'team' ? [...(await scopeResolver.teamIds(ctx))] : [],
        poolIds: scope === 'pool' ? [...(await scopeResolver.poolIds(ctx))] : [],
      }),
    );
  }
  return rooms;
}

function running(): RealtimeServer {
  if (io === null) throw new RealtimeUnavailableError();
  return io;
}

/** RT-4 — ids and a change type only. */
export function emitToUser(organizationId: string, userId: string, event: string, payload: Record<string, unknown>): void {
  try {
    io?.to(personalRoom(organizationId, userId)).emit(event, payload);
  } catch (error) {
    console.error(JSON.stringify({ level: 'warn', msg: 'realtime emit skipped', event, error: String(error) }));
  }
}

/** Everyone whose scope on the channel covers `subject` hears it, once. */
export function emitAboutPerson(
  organizationId: string,
  channelName: string,
  subject: Subject,
  event: string,
  payload: Record<string, unknown>,
): void {
  const channel = channels.get(channelName);
  if (channel === undefined) throw new Error(`Channel "${channelName}" is not defined`);
  running().to(subjectRooms(organizationId, channel, subject)).emit(event, payload);
}

interface PermissionsChangedPayload {
  readonly positionId?: string;
  readonly holderIds?: readonly string[];
}

/**
 * RT-3. At least once (D22): a second delivery repeats a notice the client
 * already acted on and closes sockets that have already reconnected with the
 * new rooms — harmless.
 */
function handlePermissionsChanged(): void {
  if (permissionsHandlerRegistered) return;
  permissionsHandlerRegistered = true;
  onOutboxEvent(AUTHORIZATION_EVENTS.PERMISSIONS_CHANGED, async (event) => {
    const server = running();
    const payload = (event.payload ?? {}) as PermissionsChangedPayload;
    for (const userId of payload.holderIds ?? []) {
      const room = personalRoom(event.organizationId, userId);
      server.to(room).emit(AUTHORIZATION_EVENTS.PERMISSIONS_CHANGED, {
        eventId: event.id,
        positionId: payload.positionId ?? null,
      });
      server.in(room).disconnectSockets(true);
    }
  });
}

export async function startRealtime(httpServer: HttpServer, options: { redisUrl?: string; path?: string } = {}): Promise<void> {
  if (io !== null) return;
  const config = loadConfig();
  const url = options.redisUrl ?? config.REDIS_URL;
  publisher = new Redis(url, { maxRetriesPerRequest: null, lazyConnect: true, retryStrategy: () => null });
  subscriber = publisher.duplicate({ lazyConnect: true, retryStrategy: () => null });
  for (const client of [publisher, subscriber]) {
    client.on('error', (error) => {
      console.error(JSON.stringify({ level: 'warn', msg: 'realtime redis error', error: String(error) }));
    });
  }
  let adapter: ReturnType<typeof createAdapter> | undefined;
  try {
    await Promise.all([publisher.connect(), subscriber.connect()]);
    adapter = createAdapter(publisher, subscriber);
  } catch (error) {
    console.error(JSON.stringify({ level: 'warn', msg: 'realtime running without Redis adapter', error: String(error) }));
    await Promise.allSettled([publisher.quit(), subscriber.quit()]);
    publisher = null;
    subscriber = null;
  }

  const server: RealtimeServer = new Server(httpServer, {
    path: options.path ?? `${config.API_BASE_PATH}/socket.io`,
    serveClient: false,
    ...(adapter === undefined ? {} : { adapter }),
  });

  server.use((socket, next) => {
    const token: unknown = socket.handshake.auth['token'];
    if (typeof token !== 'string' || token.length === 0) {
      next(new Error('UNAUTHENTICATED'));
      return;
    }
    socket.data.token = token;
    resolveSocket(token)
      .then(async (identity) => {
        if (identity === null || identity.expiresAt.getTime() <= Date.now()) {
          next(new Error('UNAUTHENTICATED'));
          return;
        }
        socket.data.identity = identity;
        socket.data.rooms = await roomsFor(identity);
        next();
      })
      .catch(() => next(new Error('UNAUTHENTICATED')));
  });

  server.on('connection', (socket) => {
    const { identity, rooms } = socket.data;
    void socket.join(rooms);
    socket.on('chat:typing', (payload: unknown) => {
      void (async () => {
        if (!typingAuthorizer || typeof payload !== 'object' || payload === null) return;
        const { conversationId, state } = payload as Record<string, unknown>;
        if (typeof conversationId !== 'string' || (state !== 'start' && state !== 'stop')) return;
        const userId = identity.principal?.id ?? identity.userId;
        if (!userId) return;
        const memberIds = await typingAuthorizer(identity.organizationId, userId, conversationId);
        if (!memberIds) return;
        for (const memberId of memberIds) {
          if (memberId !== userId) {
            server.to(personalRoom(identity.organizationId, memberId)).emit('chat:typing', { conversationId, userId, state });
          }
        }
      })().catch((error) => {
        console.error(JSON.stringify({ level: 'warn', msg: 'chat typing relay failed', error: String(error) }));
      });
    });
    const expiry = setTimeout(() => socket.disconnect(true), identity.expiresAt.getTime() - Date.now());
    expiry.unref();
    const revalidate = setInterval(() => {
      void resolveSocket(socket.data.token, { touch: false })
        .then((current) => {
          const currentUserId = current?.principal?.id ?? current?.userId;
          const connectedUserId = identity.principal?.id ?? identity.userId;
          if (!current || currentUserId !== connectedUserId || current.organizationId !== identity.organizationId) {
            socket.disconnect(true);
          }
        })
        .catch(() => socket.disconnect(true));
    }, REVALIDATE_MS);
    revalidate.unref();
    socket.on('disconnect', () => {
      clearTimeout(expiry);
      clearInterval(revalidate);
    });
  });

  io = server;
  handlePermissionsChanged();
}

/** Closes this instance's sockets. Leaves the HTTP server to its owner. */
export async function stopRealtime(): Promise<void> {
  const server = io;
  io = null;
  if (server !== null) {
    server.local.disconnectSockets(true);
    server.engine.close();
  }
  await Promise.allSettled([publisher?.quit(), subscriber?.quit()]);
  publisher = null;
  subscriber = null;
}

/** Tests only. */
export function __resetRealtime(): void {
  channels.clear();
  resolveSocket = async () => null;
}
