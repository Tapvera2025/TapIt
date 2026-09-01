import { Redis, type Redis as RedisClient } from 'ioredis';
import { loadConfig } from '../../config.js';

/**
 * The Redis connection — TECH.md §2.3.
 *
 *   "Cache / pub-sub: Redis. Session versions, permission sets, socket fan-out
 *    and queue backing."
 *
 * One lazily-created connection per process, shared by everything that needs
 * cross-process state. Kept in `platform` for the same reason the pg pool is:
 * a module that creates its own connection is a module whose connection count
 * nobody is budgeting (DP-8).
 *
 * What belongs in here is state that must be SHARED between API replicas and
 * must SURVIVE a deploy — brute-force counters, rate-limit windows, cached
 * permission sets. What does not belong in here is anything authoritative:
 * Redis is a cache and a coordination point, never a system of record. If a key
 * is missing, the correct behaviour is always to fall back to PostgreSQL, not
 * to assume the absence means something.
 */

let client: RedisClient | null = null;

export function getRedis(): RedisClient {
  if (client === null) {
    const config = loadConfig();
    client = new Redis(config.REDIS_URL, {
      // Commands issued in the first moments after boot, before the socket is
      // up, are queued rather than rejected. Without this the first few
      // requests after every deploy fail on a cache that is merely still
      // connecting — which looks exactly like a cache that is down, and trains
      // everyone to ignore the alert.
      enableOfflineQueue: true,
      // But a genuinely dead Redis fails fast rather than queueing forever. A
      // security control that hangs is worse than one that is loudly broken.
      maxRetriesPerRequest: 2,
      connectTimeout: 3_000,
      keyPrefix: 'tapcrm:',
    });

    client.on('error', (error: Error) => {
      // Never crash the process over a cache connection. Callers decide what a
      // Redis failure means for them; most of them fail closed.
      console.error(
        JSON.stringify({ level: 'error', msg: 'redis connection error', err: error.message }),
      );
    });
  }
  return client;
}

export async function closeRedis(): Promise<void> {
  if (client === null) return;
  const closing = client;
  client = null;
  await closing.quit().catch(() => undefined);
}

/** Boot check. A misconfigured cache should fail at deploy, not on the first login. */
export async function pingRedis(): Promise<boolean> {
  try {
    return (await getRedis().ping()) === 'PONG';
  } catch {
    return false;
  }
}
