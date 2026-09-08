import { Redis } from 'ioredis';
import { loadConfig } from '../../../config.js';

const failures = new Map<string, { count: number; until: number }>();
let redis: Redis | null = null;

function store() {
  if (loadConfig().SECURITY_COUNTER_STORE !== 'redis') return null;
  return (redis ??= new Redis(loadConfig().REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 }));
}

function key(kind: 'account' | 'source', value: string): string {
  return `tapcrm:identity:login-failures:${kind}:${value.trim().toLowerCase()}`;
}

export async function assertLoginAllowed(email: string, ip: string | null): Promise<void> {
  const now = Date.now();
  for (const candidate of [key('account', email), key('source', ip ?? 'unknown')]) {
    const client = store();
    if (client) {
      const until = await client.get(`${candidate}:lock`);
      if (until && Number(until) > now) throw new Error('Too many sign-in attempts. Try again later.');
    } else {
      const entry = failures.get(candidate);
      if (entry && entry.until > now) throw new Error('Too many sign-in attempts. Try again later.');
    }
  }
}

export async function recordLoginFailure(email: string, ip: string | null): Promise<{ locked: boolean }> {
  let locked = false;
  for (const candidate of [key('account', email), key('source', ip ?? 'unknown')]) {
    const client = store();
    if (client) {
      const count = await client.incr(candidate);
      await client.expire(candidate, 900);
      if (count >= 5) {
        await client.set(`${candidate}:lock`, String(Date.now() + 900_000), 'EX', 900);
        locked = true;
      }
    } else {
      const current = failures.get(candidate) ?? { count: 0, until: 0 };
      current.count += 1;
      current.until = current.count >= 5 ? Date.now() + 900_000 : Date.now() + Math.min(current.count * 1000, 30_000);
      failures.set(candidate, current);
      locked ||= current.count >= 5;
    }
  }
  return { locked };
}

export async function clearLoginFailures(email: string, ip: string | null): Promise<void> {
  for (const candidate of [key('account', email), key('source', ip ?? 'unknown')]) {
    const client = store();
    if (client) await client.del(candidate, `${candidate}:lock`);
    else failures.delete(candidate);
  }
}
