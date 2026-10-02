import type { Server as HttpServer } from 'node:http';
import { installSocketPrincipalResolver, startRealtime as startScopedRealtime } from './server.js';
import { personalRoom } from './rooms.js';
import type { SocketIdentity } from './server.js';

/** Compatibility entrypoint for notification modules. The People realtime
 * server owns the single Socket.IO listener and notification events use its
 * same tenant-qualified personal rooms. */
export type SocketAuthenticator = (
  token: string,
  options?: { touch?: boolean },
) => Promise<{ userId: string; organizationId: string } | null>;

export const userRoom = personalRoom;
export { emitToUser, installTypingAuthorizer, stopRealtime } from './server.js';

export async function startRealtime(server: HttpServer, authenticate: SocketAuthenticator): Promise<void> {
  installSocketPrincipalResolver(async (token, options): Promise<SocketIdentity | null> => {
    const identity = await authenticate(token, options);
    if (!identity) return null;
    return { ...identity, expiresAt: new Date(Date.now() + 5 * 60_000) };
  });
  await startScopedRealtime(server);
}
