import { getRedis } from '../redis/client.js';
import { loadConfig } from '../../config.js';

/**
 * Shared counters and locks for the security controls — ID-9, SE-5.
 *
 * Brute-force protection and rate limiting are only controls if they hold
 * across the whole deployment. Counting failed logins in a process-local Map
 * gives an attacker two free bypasses: spread the attempts across the API
 * replicas the topology in TECH §16.2 already assumes, or wait for the next
 * rolling deploy (DP-2) to reset every counter to zero. Neither requires any
 * skill.
 *
 * So the counters live in Redis, which every replica shares and no deploy
 * clears.
 *
 * Two shapes are enough for everything the product needs:
 *
 *   hit()   a fixed-window counter — "how many attempts in the last N minutes"
 *   lock()  a durable "this key is barred until T"
 *
 * A lock is stored rather than derived from the counter, because a lockout has
 * its own clock: the count that triggered it can expire out of its window while
 * the lockout is still running.
 */

export interface CounterHit {
  /** Attempts recorded in the current window, including this one. */
  readonly count: number;
  /** When the window rolls over, as epoch milliseconds. */
  readonly resetAt: number;
}

export interface CounterStore {
  hit(key: string, windowMs: number): Promise<CounterHit>;
  peek(key: string): Promise<number>;
  clear(key: string): Promise<void>;
  lock(key: string, forMs: number): Promise<void>;
  /** Milliseconds remaining on the lock, or null when it is not locked. */
  lockedFor(key: string): Promise<number | null>;
}

/**
 * INCR and its expiry have to be one atomic step. Two round trips leave a
 * window where a key is incremented but never given a TTL — which turns a
 * fifteen-minute lockout into a permanent one for whoever hits that race.
 */
const HIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return {count, redis.call('PTTL', KEYS[1])}
`;

class RedisCounterStore implements CounterStore {
  async hit(key: string, windowMs: number): Promise<CounterHit> {
    const result = (await getRedis().eval(HIT_SCRIPT, 1, key, String(windowMs))) as [
      number,
      number,
    ];
    const [count, ttl] = result;
    return { count, resetAt: Date.now() + Math.max(ttl, 0) };
  }

  async peek(key: string): Promise<number> {
    const value = await getRedis().get(key);
    return value === null ? 0 : Number(value);
  }

  async clear(key: string): Promise<void> {
    await getRedis().del(key);
  }

  async lock(key: string, forMs: number): Promise<void> {
    await getRedis().set(`lock:${key}`, String(Date.now() + forMs), 'PX', forMs);
  }

  async lockedFor(key: string): Promise<number | null> {
    const ttl = await getRedis().pttl(`lock:${key}`);
    return ttl > 0 ? ttl : null;
  }
}

/**
 * Single-process fallback for local development and tests.
 *
 * Explicitly refused in production at boot, because a control that works on one
 * machine and quietly stops working on three is worse than no control: the
 * dashboard still shows lockouts happening.
 */
class MemoryCounterStore implements CounterStore {
  private readonly counts = new Map<string, { count: number; resetAt: number }>();
  private readonly locks = new Map<string, number>();

  private sweep(now: number): void {
    for (const [key, entry] of this.counts) if (entry.resetAt <= now) this.counts.delete(key);
    for (const [key, until] of this.locks) if (until <= now) this.locks.delete(key);
  }

  hit(key: string, windowMs: number): Promise<CounterHit> {
    const now = Date.now();
    this.sweep(now);
    const existing = this.counts.get(key);
    const entry =
      existing === undefined || existing.resetAt <= now
        ? { count: 0, resetAt: now + windowMs }
        : existing;
    entry.count += 1;
    this.counts.set(key, entry);
    return Promise.resolve({ count: entry.count, resetAt: entry.resetAt });
  }

  peek(key: string): Promise<number> {
    const entry = this.counts.get(key);
    return Promise.resolve(entry === undefined || entry.resetAt <= Date.now() ? 0 : entry.count);
  }

  clear(key: string): Promise<void> {
    this.counts.delete(key);
    this.locks.delete(key);
    return Promise.resolve();
  }

  lock(key: string, forMs: number): Promise<void> {
    this.locks.set(key, Date.now() + forMs);
    return Promise.resolve();
  }

  lockedFor(key: string): Promise<number | null> {
    const until = this.locks.get(key);
    if (until === undefined) return Promise.resolve(null);
    const remaining = until - Date.now();
    return Promise.resolve(remaining > 0 ? remaining : null);
  }
}

let store: CounterStore | null = null;

export function getCounterStore(): CounterStore {
  if (store === null) {
    store = useMemoryStore() ? new MemoryCounterStore() : new RedisCounterStore();
  }
  return store;
}

function useMemoryStore(): boolean {
  const config = loadConfig();
  if (config.NODE_ENV === 'production') return false;
  return config.SECURITY_COUNTER_STORE === 'memory';
}

/**
 * Boot assertion. A deployment where the shared store is unreachable must fail
 * to start rather than serve traffic with brute-force protection that is
 * silently per-process.
 */
export function assertCounterStoreIsShared(): void {
  const config = loadConfig();
  if (config.NODE_ENV === 'production' && config.SECURITY_COUNTER_STORE === 'memory') {
    throw new Error(
      'SECURITY_COUNTER_STORE=memory is refused in production. Brute-force counters and ' +
        'rate limits must be shared across replicas and survive a deploy (ID-9, SE-5).',
    );
  }
}

/** Test-only. */
export function __resetCounterStore(): void {
  store = null;
}
