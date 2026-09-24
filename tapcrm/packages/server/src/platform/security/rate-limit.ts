import { Redis } from 'ioredis';
import { loadConfig } from '../../config.js';

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly count: number;
  readonly retryAfterSeconds: number;
}

const counters = new Map<string, { count: number; expiresAt: number }>();
let redis: Redis | null = null;

function store(): Redis | null {
  if (loadConfig().SECURITY_COUNTER_STORE !== 'redis') return null;
  return (redis ??= new Redis(loadConfig().REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 }));
}

function nowWindow(windowSeconds: number): { id: number; startsAt: number; expiresAt: number } {
  const seconds = Math.max(1, Math.floor(windowSeconds));
  const id = Math.floor(Date.now() / (seconds * 1000));
  const startsAt = id * seconds * 1000;
  return { id, startsAt, expiresAt: startsAt + seconds * 1000 };
}

/** Shared fixed-window counter for request abuse controls. */
export async function consumeRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const window = nowWindow(windowSeconds);
  const redisStore = store();
  if (redisStore) {
    const redisKey = `tapcrm:rate-limit:${key}:${window.id}`;
    const count = await redisStore.incr(redisKey);
    if (count === 1) await redisStore.expire(redisKey, Math.max(1, Math.ceil((window.expiresAt - Date.now()) / 1000)));
    return {
      allowed: count <= limit,
      count,
      retryAfterSeconds: Math.max(1, Math.ceil((window.expiresAt - Date.now()) / 1000)),
    };
  }

  const counterKey = `${key}:${window.id}`;
  const current = counters.get(counterKey);
  const count = current && current.expiresAt > Date.now() ? current.count + 1 : 1;
  counters.set(counterKey, { count, expiresAt: window.expiresAt });
  for (const [candidate, value] of counters) if (value.expiresAt <= Date.now()) counters.delete(candidate);
  return {
    allowed: count <= limit,
    count,
    retryAfterSeconds: Math.max(1, Math.ceil((window.expiresAt - Date.now()) / 1000)),
  };
}

/** Test-only reset; production code never needs to clear shared counters. */
export function __resetRateLimits(): void {
  counters.clear();
}
